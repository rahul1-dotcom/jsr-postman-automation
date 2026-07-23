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

/**
 * Handles Postman post-response validation, dynamic data capture, and workflow routing.
 * 
 * @param pm The Postman execution context (`pm`)
 * @param controllerName Target request name for setNextRequest on failure (e.g., "Controller")
 * @param validationObject JSON path string to extract validation value (e.g., "data[0].FreightShipment[0].ShipmentId")
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
        // 1. Process Validation Object
        if (validationObject) {
            validatedValue = getNestedValue(jsonData, validationObject);

            if (validatedValue !== undefined && validatedValue !== null) {
                // Extract last property key from path to use as variable name (e.g. "ShipmentId")
                const varName = validationObject.split('.').pop()?.replace(/\[\d+\]/g, '') || "ValidationValue";
                console.log(`✅ Found [${varName}]: ${validatedValue}`);
                pm.collectionVariables.set(varName, validatedValue);
            } else {
                console.log(`⚠️ "${validationObject}" not found in response.`);
            }
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
        pm.test("Invoice Search", function () {
            pm.expect(validatedValue, `Validation failed: Path "${validationObject}" was not found or response was invalid.`).to.exist;
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
        console.log("Loaded " + ids.length + " OBJECT_IDs: " + ids.join(", "));
    } else {
        console.error("No data found!");
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