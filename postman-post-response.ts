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