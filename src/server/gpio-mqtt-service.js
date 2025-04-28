// src/server/gpio-mqtt-service.js

// This script runs on the Raspberry Pi to read GPIO and publish MQTT messages.

const mqtt = require('mqtt');
// Require the onoff library - make sure it's installed (npm install onoff)
// Note: onoff requires running Node.js with root or gpio group privileges.
// const Gpio = require('onoff').Gpio;

// MQTT Configuration (should match your broker setup)
const MQTT_BROKER = "192.168.5.5"; // Your broker address
const MQTT_PORT = 1883; // Your broker port (likely TCP for server-side)
const MQTT_CLIENT_ID = "PiGpioService"; // Unique Client ID for this service
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; // Topic to publish sensor state
// const REJECT_OUTPUT_TOPIC_COMMAND = "Tekpak/F6/RejectOutput/Command"; // Topic to subscribe for reject commands (optional)

// GPIO Configuration (BCM pin numbers)
const PRODUCT_SENSOR_PIN = 17; // GPIO pin for the product sensor input
// const REJECT_OUTPUT_PIN = 27; // GPIO pin for the reject output

// Initialize MQTT Client
const client = mqtt.connect(`mqtt://${MQTT_BROROKER}:${MQTT_PORT}`, { clientId: MQTT_CLIENT_ID });

client.on('connect', () => {
    console.log(`[GPIO-MQTT] Connected to MQTT Broker: ${MQTT_BROKER}:${MQTT_PORT}`);
    // Subscribe to command topics if needed
    // client.subscribe(REJECT_OUTPUT_TOPIC_COMMAND, (err) => {
    //     if (!err) { console.log(`[GPIO-MQTT] Subscribed to ${REJECT_OUTPUT_TOPIC_COMMAND}`); }
    // });
});

client.on('error', (err) => {
    console.error('[GPIO-MQTT] MQTT Connection Error:', err);
});

client.on('offline', () => {
    console.warn('[GPIO-MQTT] MQTT Client Offline');
});

client.on('reconnect', () => {
    console.log('[GPIO-MQTT] MQTT Client Attempting Reconnect');
});

// --- GPIO Reading and Publishing ---
// Note: Actual GPIO interaction needs to be implemented here using a library like 'onoff'.
// The code below is a placeholder/example structure.

// Placeholder for GPIO input (replace with actual onoff input)
// const productSensorInput = new Gpio(PRODUCT_SENSOR_PIN, 'in', 'both'); // 'both' for rising and falling edges

// productSensorInput.watch((err, value) => {
//     if (err) { console.error('[GPIO-MQTT] GPIO Watch Error:', err); return; }

//     const state = value === 1 ? 'detected' : 'not detected';
//     console.log(`[GPIO-MQTT] GPIO ${PRODUCT_SENSOR_PIN} state changed to: ${state}`);

//     // Publish the sensor state to MQTT
//     if (client.connected) {
//         client.publish(PRODUCT_SENSOR_TOPIC, state, (publishErr) => {
//             if (publishErr) { console.error('[GPIO-MQTT] Failed to publish sensor state:', publishErr); }
//         });
//     } else {
//         console.warn('[GPIO-MQTT] MQTT client not connected, cannot publish sensor state.');
//     }
// });

// --- GPIO Output Control (Optional - if controlled by MQTT commands) ---
// Note: Actual GPIO output interaction needs to be implemented here.

// Placeholder for GPIO output (replace with actual onoff output)
// const rejectOutput = new Gpio(REJECT_OUTPUT_PIN, 'out');

// client.on('message', (topic, message) => {
//     console.log(`[GPIO-MQTT] Received message on topic ${topic}: ${message.toString()}`);
//     if (topic === REJECT_OUTPUT_TOPIC_COMMAND) {
//         const command = message.toString();
//         if (command === 'ACTIVATE') {
//             console.log('[GPIO-MQTT] Activating reject output');
//             rejectOutput.write(1); // Set GPIO high
//         } else if (command === 'DEACTIVATE') {
//             console.log('[GPIO-MQTT] Deactivating reject output');
//             rejectOutput.write(0); // Set GPIO low
//         }
//     }
// });

// --- Cleanup on Exit (Important for GPIO) ---
// Note: Ensure GPIO pins are released when the script stops.
// process.on('SIGINT', () => {
//     console.log('[GPIO-MQTT] Shutting down GPIO-MQTT service...');
//     if (productSensorInput) productSensorInput.unexport();
//     if (rejectOutput) rejectOutput.unexport();
//     if (client) client.end();
//     process.exit();
// });

console.log('[GPIO-MQTT] GPIO-MQTT service started. Waiting for MQTT connection...');

// Keep the process running
process.stdin.resume(); // Prevents the process from exiting immediately
