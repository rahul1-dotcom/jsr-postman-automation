/**
 * Safely resolves nested property paths from an object (e.g., "data[0].FreightShipment[0].ShipmentId")
 */
function getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;

    // Convert bracket notation (e.g., data[0]) to dot notation (e.g., data.0)
    const formattedPath = path.replace(/\[(\w+)\]/g, '.$1');

    return formattedPath.split('.').reduce((prev, curr) => {
        return prev && prev[curr] !== undefined ? prev[curr] : undefined;
    }, obj);
}

/** Parses a JSONPath filter literal (true/false/null/number/quoted string) into its JS value */
function parseLiteral(raw: string): any {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (/^(['"]).*\1$/.test(trimmed)) return trimmed.slice(1, -1);
    return trimmed;
}

/**
 * Evaluates a JSONPath filter expression, e.g. "?(@.success == true)" or "?(@.data.code)".
 * Returns undefined if `expr` is not a filter expression, so callers can fall back to a plain path lookup.
 */
function evaluateFilterExpression(obj: any, expr: string): boolean | undefined {
    const match = expr.trim().match(/^\?\((.*)\)$/);
    if (!match) return undefined;

    const condition = match[1].trim();
    const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];

    for (const op of operators) {
        const idx = condition.indexOf(op);
        if (idx === -1) continue;

        const leftPath = condition.slice(0, idx).trim().replace(/^@\.?/, '');
        const rightRaw = condition.slice(idx + op.length).trim();
        const leftValue = leftPath ? getNestedValue(obj, leftPath) : obj;
        const rightValue = parseLiteral(rightRaw);

        switch (op) {
            case '==': case '===': return leftValue === rightValue;
            case '!=': case '!==': return leftValue !== rightValue;
            case '>=': return leftValue >= rightValue;
            case '<=': return leftValue <= rightValue;
            case '>': return leftValue > rightValue;
            case '<': return leftValue < rightValue;
        }
    }

    // No comparison operator - treat as a truthy existence check
    const path = condition.replace(/^@\.?/, '');
    const value = path ? getNestedValue(obj, path) : obj;
    return Boolean(value);
}

/**
 * Handles Postman post-response validation, dynamic data capture, and workflow routing.
 * 
 * @param pm The Postman execution context (`pm`)
 * @param controllerName Target request name for setNextRequest on failure (e.g., "Controller")
 * @param validationObject JSONPath expression to validate against the response - either a plain path
 *   whose existence is checked (e.g., "data[0].FreightShipment[0].ShipmentId"), or a filter
 *   expression (e.g., "?(@.success == true)")
 * @param captureDataObject Array of JSON paths to capture and set as collection variables
 */
export function handlePostResponse(
    pm: any, 
    controllerName: string = "Controller", 
    validationObject?: string, 
    captureDataObject: string[] = []
): void {
    let validatedValue: any = null;
    let jsonData: any = {};

    try {
        jsonData = pm.response.json();
    } catch (e) {
        // Body is empty or non-JSON
    }

    if (pm.response.code === 200) {
        // 1. Process Validation Object (JSONPath expression) - validate only, no collection variables set
        if (validationObject) {
            const filterResult = evaluateFilterExpression(jsonData, validationObject);

            let isValid: boolean;
            if (filterResult !== undefined) {
                isValid = filterResult;
                validatedValue = isValid;
            } else {
                validatedValue = getNestedValue(jsonData, validationObject);
                isValid = validatedValue !== undefined && validatedValue !== null;
            }

            console.log(isValid
                ? `✅ Validation "${validationObject}" is a success.`
                : `❌ Validation "${validationObject}" is a failure.`);
        }

        // 2. Capture and Save Data Objects to Collection Variables
        if (Array.isArray(captureDataObject)) {
            captureDataObject.forEach(path => {
                const capturedValue = getNestedValue(jsonData, path);
                if (capturedValue !== undefined && capturedValue !== null) {
                    const varName = path.split('.').pop()?.replace(/\[\d+\]/g, '') || path;
                    pm.collectionVariables.set(varName, capturedValue);
                    console.log(`📦 Captured [${varName}]:`, capturedValue);
                } else {
                    console.log(`⚠️ Could not capture path "${path}" - Path not found.`);
                }
            });
        }
    }

    // 3. Workflow Routing & Hard Assertions
    const lastRequest = pm.collectionVariables.get("LAST-REQUEST");
    const isLastRequest = pm.info.requestName === lastRequest;

    if (pm.response.code !== 200 || !validatedValue || !lastRequest || isLastRequest) {
        // Hard failure: assert and route to dynamic Controller
        pm.test("Validation", function () {
            pm.expect(Boolean(validatedValue), `Validation failed: Path "${validationObject}" was not found or response was invalid.`).to.be.true;
        });
        pm.execution.setNextRequest(controllerName);
    }
}

/**
 * Handles a Data Runner response: extracts OBJECT_IDs from `records`, stores them
 * (along with OBJECT_NAME) as collection variables for iteration, and hard-fails
 * the request when no records are present.
 *
 * @param pm The Postman execution context (`pm`)
 */
export function handleDataRunnerResponse(pm: any): void {
    const responseJson = pm.response.json();
    const responseData = responseJson.records;

    if (Array.isArray(responseData) && responseData.length > 0) {
        const ids = responseData.map((item: any) => item.OBJECT_ID);
        pm.collectionVariables.set("ID_LIST", JSON.stringify(ids));
        pm.collectionVariables.set("ID_INDEX", "0");
        pm.collectionVariables.set("OBJECT_NAME", responseJson.OBJECT_NAME);
        console.log("📥 Loaded " + ids.length + " OBJECT_IDs: " + ids.join(", "));
    } else {
        console.error("❌ No data found!");
        pm.expect.fail("No data found!");
    }
}

/**
 * Handles the Controller request in a Data Runner loop: pulls the next OBJECT_ID
 * from ID_LIST (set by handleDataRunnerResponse), advances ID_INDEX, and stops the
 * loop (clearing collection variables) once every ID has been processed.
 *
 * @param pm The Postman execution context (`pm`)
 */
export function handleControllerResponse(pm: any): void {
    const ID_LIST = JSON.parse(pm.collectionVariables.get("ID_LIST") || "[]");
    let index = parseInt(pm.collectionVariables.get("ID_INDEX") || "0");

    if (ID_LIST.length > 0 && index < ID_LIST.length) {
        console.log("🔃 Executing " + pm.collectionVariables.get("OBJECT_NAME") + " ", index + 1, "/", ID_LIST.length);
        pm.collectionVariables.set(pm.collectionVariables.get("OBJECT_NAME"), ID_LIST[index]);
        setTimeout(() => {
        }, 100);
        index++;
        pm.collectionVariables.set("ID_INDEX", String(index));
    } else {
        console.log("✅ Loop finished. Stopping execution....");
        pm.execution.setNextRequest(null);
        pm.collectionVariables.clear();
    }
}