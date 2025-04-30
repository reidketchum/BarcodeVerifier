// gpio-test.js
const fs = require('fs');

const GPIO_PIN = 5; // The pin we are trying to use
const GPIO_EXPORT_PATH = '/sys/class/gpio/export';
const GPIO_UNEXPORT_PATH = '/sys/class/gpio/unexport';
const GPIO_PIN_PATH = `/sys/class/gpio/gpio${GPIO_PIN}`;

console.log(`[Test] Attempting to ensure GPIO ${GPIO_PIN} is unexported...`);
try {
    if (fs.existsSync(GPIO_PIN_PATH)) {
        console.log(`[Test] Pin ${GPIO_PIN} seems exported, trying to unexport...`);
        fs.writeFileSync(GPIO_UNEXPORT_PATH, GPIO_PIN.toString());
        console.log(`[Test] Unexport command sent for GPIO ${GPIO_PIN}.`);
    } else {
        console.log(`[Test] Pin ${GPIO_PIN} not currently exported.`);
    }
} catch (err) {
    console.error(`[Test] Error during unexport attempt for GPIO ${GPIO_PIN}:`, err);
    // Continue anyway to try exporting
}

console.log(`[Test] Attempting to export GPIO ${GPIO_PIN} via ${GPIO_EXPORT_PATH}...`);
try {
    fs.writeFileSync(GPIO_EXPORT_PATH, GPIO_PIN.toString());
    console.log(`[Test] Successfully exported GPIO ${GPIO_PIN}!`);
    
    // Clean up by unexporting
    console.log(`[Test] Cleaning up: unexporting GPIO ${GPIO_PIN}...`);
    fs.writeFileSync(GPIO_UNEXPORT_PATH, GPIO_PIN.toString());
    console.log(`[Test] GPIO ${GPIO_PIN} unexported successfully.`);
    
} catch (err) {
    console.error(`[Test] FAILED to export GPIO ${GPIO_PIN}:`, err);
    if (err.code === 'EINVAL') {
        console.error("----> Error code is EINVAL (Invalid Argument). This confirms the kernel is rejecting the export.");
    } else if (err.code === 'EACCES' || err.code === 'EPERM') {
        console.error("----> Error code suggests a permission issue.");
    }
}
