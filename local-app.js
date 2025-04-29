console.log('>>> local-app.js execution started <<<'); // Add this line at the very top

// local-app.js - Standalone Node.js TUI Application

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const { Gpio } = require('onoff');

// --- Configuration Loading & Saving ---
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let settings = {};

function loadSettings() {
    try {
        console.log(`[App] Loading settings from ${SETTINGS_FILE}`);
        if (fs.existsSync(SETTINGS_FILE)) {
            const rawData = fs.readFileSync(SETTINGS_FILE);
            settings = JSON.parse(rawData.toString());
            console.log("[App] Settings loaded successfully:", settings);
        } else {
            console.warn(`[App] Settings file not found at ${SETTINGS_FILE}. Using defaults (if any defined in script).`);
            // Define default settings here if file doesn't exist
            settings = {
                mqttBroker: "192.168.5.5",
                mqttPort: 1883,
                mqttVerifyTopic: "Tekpak/F6/BarcodeVerifier",
                mqttClientId: "PiLocalApp",
                rejectDelay: 3000,
                productSensorPin: 17,
                rejectOutputPin: 27
            };
            saveSettings(); // Save defaults if file didn't exist
        }
    } catch (error) {
        console.error("[App] Error loading settings:", error);
        process.exit(1);
    }
}

function saveSettings() {
    try {
        console.log(`[App] Saving settings to ${SETTINGS_FILE}`);
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); // Pretty print JSON
    } catch (error) {
        console.error("[App] Error saving settings:", error);
    }
}

// --- Global State (Simulated UI State) ---
// In a real TUI app, these would update UI elements
let currentMqttStatus = 'Disconnected';
let lastBarcode = null;
let lastResult = null;
let isCaseDetected = false;
let rejectOutputState = 'Inactive';

// --- MQTT Client Setup ---
let mqttClient = null;

function connectMqtt() {
    if (mqttClient && mqttClient.connected) {
        console.log("[MQTT] Already connected.");
        return;
    }
    if (mqttClient) {
        mqttClient.end(true); // End previous connection if any
    }

    console.log(`[MQTT] Attempting connection to mqtt://${settings.mqttBroker}:${settings.mqttPort}`);
    currentMqttStatus = 'Connecting...';
    // TODO: Update TUI with status

    mqttClient = mqtt.connect(`mqtt://${settings.mqttBroker}:${settings.mqttPort}`, { 
        clientId: settings.mqttClientId,
        connectTimeout: 5000,
        reconnectPeriod: 5000
    });

    mqttClient.on('connect', () => {
        console.log(`[MQTT] Connected to MQTT Broker: ${settings.mqttBroker}:${settings.mqttPort}`);
        currentMqttStatus = 'Connected';
        // TODO: Update TUI
        // Subscribe to necessary topics (e.g., commands)
        mqttClient.subscribe(REJECT_OUTPUT_COMMAND_TOPIC, (err) => {
            if (!err) {
                console.log(`[MQTT] Subscribed to topic: ${REJECT_OUTPUT_COMMAND_TOPIC}`);
            } else {
                console.error(`[MQTT] Failed to subscribe to ${REJECT_OUTPUT_COMMAND_TOPIC}:`, err);
            }
        });
    });

    mqttClient.on('error', (err) => {
        console.error('[MQTT] Connection Error:', err);
        currentMqttStatus = 'Error';
        // TODO: Update TUI with error
    });

    mqttClient.on('close', () => {
        console.log('[MQTT] Client Disconnected.');
        currentMqttStatus = 'Disconnected';
        // TODO: Update TUI
    });

    mqttClient.on('offline', () => {
        console.warn('[MQTT] Client Offline');
        currentMqttStatus = 'Disconnected';
        // TODO: Update TUI
    });

    mqttClient.on('reconnect', () => {
        console.log('[MQTT] Client Attempting Reconnect');
        currentMqttStatus = 'Connecting...';
        // TODO: Update TUI
    });

    // Handle incoming commands for reject output
    mqttClient.on('message', (topic, message) => {
        console.log(`[MQTT] Received message on topic ${topic}: ${message.toString()}`);
        if (topic === REJECT_OUTPUT_COMMAND_TOPIC) {
            const command = message.toString().toUpperCase();
            if (command === 'ACTIVATE') {
                activateRejectOutput();
            } else if (command === 'DEACTIVATE') {
                deactivateRejectOutput();
            }
        }
    });
}

// --- GPIO Setup & Logic ---
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State";
const REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command";
let productSensorInput = null;
let rejectOutput = null;

function initializeGpio() {
    console.log("[GPIO] Initialize function called."); // Log entry
    try {
        if (!Gpio.accessible) {
            console.error("[GPIO] GPIO is not accessible on this system. Service cannot run.");
            cleanupAndExit(1);
            return;
        }
        console.log("[GPIO] Initializing GPIO...");

        unexportPin(settings.productSensorPin);
        unexportPin(settings.rejectOutputPin);

        // Initialize Product Sensor Input Pin
        console.log(`[GPIO] Attempting to initialize pin ${settings.productSensorPin} for input...`);
        productSensorInput = new Gpio(settings.productSensorPin, 'in', 'both', { debounceTimeout: 10 });
        console.log(`[GPIO] GPIO ${settings.productSensorPin} initialized for input.`);

        // Initialize Reject Output Pin
        console.log(`[GPIO] Attempting to initialize pin ${settings.rejectOutputPin} for output...`);
        rejectOutput = new Gpio(settings.rejectOutputPin, 'out');
        console.log(`[GPIO] GPIO ${settings.rejectOutputPin} initialized for output.`);
        rejectOutput.writeSync(0); // Ensure low initially
        rejectOutputState = 'Inactive';
        // TODO: Update TUI

        // Watch for sensor changes
        productSensorInput.watch((err, value) => {
            if (err) {
                console.error('[GPIO] Watch Error:', err);
                return;
            }
            const newState = value === 1; // Assuming 1 = detected
            if (newState !== isCaseDetected) {
                 isCaseDetected = newState;
                 const stateString = isCaseDetected ? 'detected' : 'not detected';
                 console.log(`[GPIO] GPIO ${settings.productSensorPin} state changed to: ${stateString} (value: ${value})`);
                 // TODO: Update TUI with sensor state
                 
                 // Publish state to MQTT
                 if (mqttClient && mqttClient.connected) {
                     mqttClient.publish(PRODUCT_SENSOR_TOPIC, stateString, { qos: 1 }, (publishErr) => {
                         if (publishErr) console.error('[MQTT] Failed to publish sensor state:', publishErr);
                         else console.log(`[MQTT] Published state '${stateString}' to ${PRODUCT_SENSOR_TOPIC}`);
                     });
                 } else {
                     console.warn('[MQTT] Client not connected, cannot publish sensor state.');
                 }

                 // Reset barcode/result if case is no longer detected
                 if (!isCaseDetected) {
                    lastBarcode = null;
                    lastResult = null;
                    // TODO: Update TUI
                 }
            }
        });

        console.log('[GPIO] Initialization complete. Watching GPIO pin...');

    } catch (error) {
        console.error("[GPIO] Failed to initialize GPIO:", error);
        cleanupAndExit(1);
    }
}

function unexportPin(pinNumber) {
    try {
        if (!pinNumber) return;
        const exportPath = `/sys/class/gpio/export`;
        const pinPath = `/sys/class/gpio/gpio${pinNumber}`;
        if (fs.existsSync(pinPath)) {
             console.log(`[GPIO] Unexporting potentially stuck GPIO ${pinNumber}...`);
             fs.writeFileSync(exportPath, pinNumber.toString());
             console.log(`[GPIO] GPIO ${pinNumber} unexported.`);
        }
    } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EACCES' && err.code !== 'EPERM' && err.code !== 'ENOENT') {
             console.warn(`[GPIO] Warn: Could not unexport GPIO ${pinNumber}:`, err.message);
        }
    }
}

function activateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO] Activating reject output (GPIO HIGH)');
        rejectOutput.writeSync(1);
        rejectOutputState = 'Active';
        // TODO: Update TUI

        // Deactivate after delay
        setTimeout(() => {
            deactivateRejectOutput();
        }, settings.rejectDelay || 3000);
    } else {
        console.warn('[GPIO] Reject output GPIO not initialized.');
    }
}

function deactivateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO] Deactivating reject output (GPIO LOW)');
        rejectOutput.writeSync(0);
        rejectOutputState = 'Inactive';
        // TODO: Update TUI
    } else {
        console.warn('[GPIO] Reject output GPIO not initialized.');
    }
}

// --- Barcode Scanning (Simulated via Keyboard for now) ---
// TODO: Implement direct USB scanner reading if needed for headless operation
let barcodeBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true); // Read char by char
process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    if (chunk === '\u0003') { // Ctrl+C
      cleanupAndExit(0);
    }
    // Corrected check for Enter key
    if (chunk === '' || chunk === '
') { // Enter key (Carriage Return or Newline)
        handleScan(barcodeBuffer.trim());
        barcodeBuffer = '';
    } else {
        barcodeBuffer += chunk;
    }
  }
});

function handleScan(scannedBarcode) {
    if (!scannedBarcode) return;
    if (!isCaseDetected) {
        console.log("[App] Scan ignored: No case detected.");
        lastBarcode = scannedBarcode + " (Ignored)";
        lastResult = null;
        // TODO: Update TUI
        return;
    }

    console.log("[App] handleScan called with:", scannedBarcode);
    lastBarcode = scannedBarcode;
    const isValid = isValidGTIN(scannedBarcode);
    lastResult = isValid ? "PASS" : "FAIL";
    console.log(`[App] Verification Result: ${lastResult}`);
    // TODO: Update TUI

    // Publish result
    publishMqttMessage(mqttClient, settings.mqttVerifyTopic, lastResult);

    // Trigger reject if needed
    if (!isValid) {
        activateRejectOutput();
    }
}

function isValidGTIN(barcode) {
  return /^\d{12,14}$/.test(barcode);
}

function publishMqttMessage(client, topic, message) {
    if (client && client.connected) {
        console.log(`[MQTT] Publishing: '${message}' to ${topic}`); 
        client.publish(topic, message, { qos: 1 }, (err) => {
            if (err) console.error(`[MQTT] Publish Error to ${topic}: ${err.message || err}`);
        });
    } else {
        console.log(`[MQTT] Not connected. Cannot publish to ${topic}.`);
    }
}

// --- TUI Placeholder --- 
// TODO: Implement TUI using a library like 'blessed'
// This section should create the screen, dashboard elements, settings menu, etc.
// It should read the global state variables (currentMqttStatus, lastBarcode, etc.)
// and update the displayed elements.
// It should also handle user input for menu navigation and settings changes.

function setupTUI() {
    console.log("
--- TUI Placeholder ---");
    console.log("TODO: Implement Terminal User Interface here.");
    console.log("Press Ctrl+C to exit.");
    // Example: Periodically log status to simulate dashboard update
    setInterval(() => {
        console.log(`Status Update | MQTT: ${currentMqttStatus} | Sensor: ${isCaseDetected ? 'Detected' : 'Not Detected'} | Reject: ${rejectOutputState} | Last Scan: ${lastBarcode || 'None'} | Result: ${lastResult || 'N/A'}`);
    }, 5000);
}

// --- Graceful Shutdown ---
let isExiting = false;
function cleanupAndExit(exitCode = 0) {
    if (isExiting) return;
    isExiting = true;
    console.log(`
[App] Shutting down... (Exit Code: ${exitCode})`);
    let mqttClosed = false;
    let gpioCleaned = false;

    const attemptExit = () => {
        if (mqttClosed && gpioCleaned) {
            console.log("[App] Cleanup complete. Exiting.");
            process.exit(exitCode);
        }
    };

    // Cleanup GPIO
    try {
        if (productSensorInput) {
            productSensorInput.unwatchAll();
            productSensorInput.unexport();
            console.log(`[GPIO] GPIO ${settings.productSensorPin} unexported.`);
        }
        if (rejectOutput) {
            rejectOutput.writeSync(0);
            rejectOutput.unexport();
            console.log(`[GPIO] GPIO ${settings.rejectOutputPin} unexported.`);
        }
        gpioCleaned = true;
    } catch (err) {
        console.error("[GPIO] Error during cleanup:", err);
        gpioCleaned = true; // Mark as done anyway
    }

    // Cleanup MQTT
    if (mqttClient) {
        mqttClient.end(true, () => {
            console.log('[MQTT] Client disconnected.');
            mqttClosed = true;
            attemptExit();
        });
        setTimeout(() => { // Timeout for MQTT cleanup
            if (!mqttClosed) {
                console.warn('[MQTT] Client did not close gracefully, forcing exit.');
                mqttClosed = true;
                attemptExit();
            }
        }, 2000);
    } else {
        mqttClosed = true;
    }

    // Restore terminal mode
    if (process.stdin.isRaw) {
         process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    attemptExit();
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('uncaughtException', (err) => {
    console.error('[App] Uncaught Exception:', err);
    cleanupAndExit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[App] Unhandled Rejection at:', promise, 'reason:', reason);
    cleanupAndExit(1);
});

// --- Initialization ---
loadSettings();
initializeGpio(); // Initialize GPIO
connectMqtt();    // Connect to MQTT
setupTUI();      // Placeholder for TUI setup

console.log('[App] Local application started.');
