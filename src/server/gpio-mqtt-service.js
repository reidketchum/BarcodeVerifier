// src/server/gpio-mqtt-service.js

// This script runs on the Raspberry Pi to read GPIO and publish MQTT messages.

const mqtt = require('mqtt');
const { Gpio } = require('onoff'); // Import Gpio from onoff
const fs = require('fs'); // Required for checking /sys/class/gpio

// --- Configuration ---

// MQTT Configuration
const MQTT_BROKER = "192.168.5.5"; // Your broker address (TCP connection)
const MQTT_PORT = 1883; // Corrected: Standard MQTT broker port for TCP
const MQTT_CLIENT_ID = "PiGpioService"; // Unique Client ID for this service
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; // Topic to publish sensor state
const REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command"; // Topic to listen for reject commands

// GPIO Configuration (BCM pin numbers)
const PRODUCT_SENSOR_PIN_BCM = 17; // GPIO pin for the product sensor input
const REJECT_OUTPUT_PIN_BCM = 27; // GPIO pin for the reject output

let productSensorInput = null; // Initialize to null
let rejectOutput = null; // Initialize to null
let mqttClient = null; // Initialize to null

// --- MQTT Client Setup ---

function connectMqtt() {
    console.log(`[GPIO-MQTT] Attempting MQTT connection to mqtt://${MQTT_BROKER}:${MQTT_PORT}`);
    mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, { 
        clientId: MQTT_CLIENT_ID,
        connectTimeout: 5000, // 5 seconds
        reconnectPeriod: 5000 // Try reconnecting every 5 seconds
    });

    mqttClient.on('connect', () => {
        console.log(`[GPIO-MQTT] Connected to MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
        mqttClient.subscribe(REJECT_OUTPUT_COMMAND_TOPIC, (err) => {
            if (!err) {
                console.log(`[GPIO-MQTT] Subscribed to topic: ${REJECT_OUTPUT_COMMAND_TOPIC}`);
            } else {
                console.error(`[GPIO-MQTT] Failed to subscribe to ${REJECT_OUTPUT_COMMAND_TOPIC}:`, err);
            }
        });
    });

    mqttClient.on('error', (err) => {
        console.error('[GPIO-MQTT] MQTT Connection Error:', err);
    });

    mqttClient.on('offline', () => {
        console.warn('[GPIO-MQTT] MQTT Client Offline');
    });

    mqttClient.on('reconnect', () => {
        console.log('[GPIO-MQTT] MQTT Client Attempting Reconnect');
    });

    // --- MQTT Message Handling (for Commands) ---
    mqttClient.on('message', (topic, message) => {
        console.log(`[GPIO-MQTT] Received message on topic ${topic}: ${message.toString()}`);
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

// --- GPIO Setup ---

function initializeGpio() {
    try {
        if (!Gpio.accessible) {
            console.error("[GPIO-MQTT] GPIO is not accessible on this system. Exiting.");
            cleanupAndExit(1); // Exit with error code
            return;
        }

        console.log("[GPIO-MQTT] Initializing GPIO...");

        // Check if pins are already exported and unexport if necessary
        unexportPin(PRODUCT_SENSOR_PIN_BCM);
        unexportPin(REJECT_OUTPUT_PIN_BCM);

        // Initialize Product Sensor Input Pin (GPIO 17)
        productSensorInput = new Gpio(PRODUCT_SENSOR_PIN_BCM, 'in', 'both', {
            debounceTimeout: 10 // Optional debounce
        });
        console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} initialized for input.`);

        // --- Temporarily Commented Out Reject Output Initialization ---
        // rejectOutput = new Gpio(REJECT_OUTPUT_PIN_BCM, 'out');
        // console.log(`[GPIO-MQTT] GPIO ${REJECT_OUTPUT_PIN_BCM} initialized for output.`);
        // if (rejectOutput) rejectOutput.writeSync(0); // Ensure output is initially low (inactive)
        // --- End Temporary Comment Out ---

        // Watch for changes on the product sensor pin
        productSensorInput.watch((err, value) => {
            if (err) {
                console.error('[GPIO-MQTT] GPIO Watch Error:', err);
                return;
            }
            
            // Determine state based on value (assuming 1 = detected, 0 = not detected)
            const state = value === 1 ? 'detected' : 'not detected';
            console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} state changed to: ${state} (value: ${value})`);

            // Publish the sensor state to MQTT
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(PRODUCT_SENSOR_TOPIC, state, { qos: 1 }, (publishErr) => {
                    if (publishErr) {
                        console.error('[GPIO-MQTT] Failed to publish sensor state:', publishErr);
                    } else {
                        console.log(`[GPIO-MQTT] Published state '${state}' to ${PRODUCT_SENSOR_TOPIC}`);
                    }
                });
            } else {
                console.warn('[GPIO-MQTT] MQTT client not connected, cannot publish sensor state.');
            }
        });

        console.log('[GPIO-MQTT] GPIO initialization complete. Watching GPIO pin...');

    } catch (error) {
        console.error("[GPIO-MQTT] Failed to initialize GPIO:", error);
        // Attempt cleanup even if GPIO init fails partially
        cleanupAndExit(1); // Exit with error code
    }
}

// Helper function to safely unexport a GPIO pin if it's exported
function unexportPin(pinNumber) {
    try {
        const exportPath = `/sys/class/gpio/export`;
        const pinPath = `/sys/class/gpio/gpio${pinNumber}`;
        if (fs.existsSync(pinPath)) {
             console.log(`[GPIO-MQTT] Unexporting potentially stuck GPIO ${pinNumber}...`);
             // Use synchronous write for simplicity in cleanup context
             fs.writeFileSync(exportPath, pinNumber.toString());
             console.log(`[GPIO-MQTT] GPIO ${pinNumber} unexported.`);
        }
    } catch (err) {
        // Ignore errors like EBUSY (already exported) or permission errors during unexport attempt
        if (err.code !== 'EBUSY' && err.code !== 'EACCES' && err.code !== 'EPERM') {
             console.warn(`[GPIO-MQTT] Warn: Could not unexport GPIO ${pinNumber}:`, err.message);
        }
       
    }
}

// --- GPIO Output Control Functions ---

function activateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO-MQTT] Activating reject output (GPIO HIGH)');
        rejectOutput.writeSync(1);
    } else {
        console.warn('[GPIO-MQTT] Reject output GPIO not initialized (commented out?).');
    }
}

function deactivateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO-MQTT] Deactivating reject output (GPIO LOW)');
        rejectOutput.writeSync(0);
    } else {
        console.warn('[GPIO-MQTT] Reject output GPIO not initialized (commented out?).');
    }
}

// --- Graceful Shutdown ---

let isExiting = false;
function cleanupAndExit(exitCode = 0) {
    if (isExiting) return; // Prevent multiple calls
    isExiting = true;

    console.log(`
[GPIO-MQTT] Shutting down GPIO-MQTT service... (Exit Code: ${exitCode})`);
    let mqttClosed = false;
    let gpioCleaned = false;

    const attemptExit = () => {
        if (mqttClosed && gpioCleaned) {
            console.log("[GPIO-MQTT] Cleanup complete. Exiting.");
            process.exit(exitCode);
        }
    };

    // Cleanup GPIO
    try {
        if (productSensorInput) {
            productSensorInput.unwatchAll(); // Stop watching first
            productSensorInput.unexport();
            console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} unexported.`);
        }
        // Only attempt to unexport rejectOutput if it was initialized
        if (rejectOutput) {
            rejectOutput.writeSync(0); // Ensure low
            rejectOutput.unexport();
            console.log(`[GPIO-MQTT] GPIO ${REJECT_OUTPUT_PIN_BCM} unexported.`);
        }
        gpioCleaned = true;
    } catch (err) {
        console.error("[GPIO-MQTT] Error during GPIO cleanup:", err);
        gpioCleaned = true; // Mark as done even if error
    }

    // Cleanup MQTT
    if (mqttClient) {
        mqttClient.end(true, () => {
             console.log('[GPIO-MQTT] MQTT client disconnected.');
             mqttClosed = true;
             attemptExit();
        });
        // Timeout for MQTT cleanup
        setTimeout(() => {
            if (!mqttClosed) {
                 console.warn('[GPIO-MQTT] MQTT client did not close gracefully, forcing exit.');
                 mqttClosed = true;
                 attemptExit();
            }
        }, 2000); 
    } else {
        mqttClosed = true;
    }

    // If MQTT was already done, attempt exit immediately
    attemptExit(); 
}

// Catch signals for graceful shutdown
process.on('SIGINT', () => cleanupAndExit(0));  // Catch Ctrl+C
process.on('SIGTERM', () => cleanupAndExit(0)); // Catch kill/system shutdown
process.on('uncaughtException', (err) => {
    console.error('[GPIO-MQTT] Uncaught Exception:', err);
    cleanupAndExit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[GPIO-MQTT] Unhandled Rejection at:', promise, 'reason:', reason);
    cleanupAndExit(1);
});

// --- Initialization ---
initializeGpio(); // Initialize GPIO first
connectMqtt();    // Then connect to MQTT

console.log('[GPIO-MQTT] GPIO-MQTT service started.');
