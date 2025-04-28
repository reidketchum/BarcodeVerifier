// src/server/gpio-mqtt-service.js

// This script runs on the Raspberry Pi to read GPIO and publish MQTT messages.

const mqtt = require('mqtt');
const { Gpio } = require('onoff'); // Import Gpio from onoff

// --- Configuration ---

// MQTT Configuration
const MQTT_BROKER = "192.168.5.5"; // Your broker address (TCP connection)
const MQTT_PORT = 1883; // Your standard MQTT broker port
const MQTT_CLIENT_ID = "PiGpioService"; // Unique Client ID for this service
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; // Topic to publish sensor state
const REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command"; // Topic to listen for reject commands

// GPIO Configuration (BCM pin numbers)
const PRODUCT_SENSOR_PIN_BCM = 17; // GPIO pin for the product sensor input
const REJECT_OUTPUT_PIN_BCM = 27; // GPIO pin for the reject output

let productSensorInput;
let rejectOutput;
let mqttClient;

// --- MQTT Client Setup ---

try {
    console.log(`[GPIO-MQTT] Attempting MQTT connection to mqtt://${MQTT_BROKER}:${MQTT_PORT}`);
    mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, { 
        clientId: MQTT_CLIENT_ID,
        connectTimeout: 5000, // 5 seconds
        reconnectPeriod: 5000 // Try reconnecting every 5 seconds
    });

    mqttClient.on('connect', () => {
        console.log(`[GPIO-MQTT] Connected to MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
        // Subscribe to the command topic for the reject output
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

} catch (error) {
    console.error("[GPIO-MQTT] Failed to initialize MQTT client:", error);
    process.exit(1); // Exit if MQTT fails to initialize
}

// --- GPIO Setup ---

try {
    // Initialize Product Sensor Input Pin (GPIO 17)
    if (Gpio.accessible) {
        console.log("[GPIO-MQTT] Initializing GPIO...");
        productSensorInput = new Gpio(PRODUCT_SENSOR_PIN_BCM, 'in', 'both', { 
            debounceTimeout: 10 // Optional debounce 
        });
        console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} initialized for input.`);

        // Initialize Reject Output Pin (GPIO 27)
        rejectOutput = new Gpio(REJECT_OUTPUT_PIN_BCM, 'out');
        console.log(`[GPIO-MQTT] GPIO ${REJECT_OUTPUT_PIN_BCM} initialized for output.`);
        rejectOutput.writeSync(0); // Ensure output is initially low (inactive)

        // Watch for changes on the product sensor pin
        productSensorInput.watch((err, value) => {
            if (err) {
                console.error('[GPIO-MQTT] GPIO Watch Error:', err);
                return;
            }

            // Determine state based on value (assuming 1 = detected, 0 = not detected)
            // Adjust logic based on your sensor's active state (high or low)
            const state = value === 1 ? 'detected' : 'not detected';
            console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} state changed to: ${state} (value: ${value})`);

            // Publish the sensor state to MQTT
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(PRODUCT_SENSOR_TOPIC, state, { qos: 1 }, (publishErr) => { // Added QoS
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

    } else {
        console.error("[GPIO-MQTT] GPIO is not accessible on this system. Exiting.");
        if (mqttClient) mqttClient.end();
        process.exit(1);
    }

} catch (error) {
    console.error("[GPIO-MQTT] Failed to initialize GPIO:", error);
    if (mqttClient) mqttClient.end();
    process.exit(1);
}

// --- GPIO Output Control Functions ---

function activateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO-MQTT] Activating reject output (GPIO HIGH)');
        rejectOutput.writeSync(1); // Set GPIO high using synchronous write for reliability
    } else {
        console.warn('[GPIO-MQTT] Reject output GPIO not initialized.');
    }
}

function deactivateRejectOutput() {
    if (rejectOutput) {
        console.log('[GPIO-MQTT] Deactivating reject output (GPIO LOW)');
        rejectOutput.writeSync(0); // Set GPIO low using synchronous write
    } else {
        console.warn('[GPIO-MQTT] Reject output GPIO not initialized.');
    }
}


// --- Graceful Shutdown ---

function cleanupAndExit() {
    console.log('
[GPIO-MQTT] Shutting down GPIO-MQTT service...');
    if (productSensorInput) {
        productSensorInput.unexport();
        console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN_BCM} unexported.`);
    }
    if (rejectOutput) {
        rejectOutput.writeSync(0); // Ensure output is low before unexporting
        rejectOutput.unexport();
        console.log(`[GPIO-MQTT] GPIO ${REJECT_OUTPUT_PIN_BCM} unexported.`);
    }
    if (mqttClient) {
        mqttClient.end(true, () => { // Force close and callback
             console.log('[GPIO-MQTT] MQTT client disconnected.');
             process.exit(0);
        });
    } else {
         process.exit(0);
    }
    // Set a timeout in case MQTT doesn't close gracefully
    setTimeout(() => {
        console.warn('[GPIO-MQTT] MQTT client did not close gracefully, forcing exit.');
        process.exit(1);
    }, 2000); 
}

// Catch signals for graceful shutdown
process.on('SIGINT', cleanupAndExit);  // Catch Ctrl+C
process.on('SIGTERM', cleanupAndExit); // Catch kill/system shutdown

console.log('[GPIO-MQTT] GPIO-MQTT service initialization complete. Watching GPIO pin...');

// Keep the process running (not strictly necessary when using GPIO watch)
// process.stdin.resume(); 
