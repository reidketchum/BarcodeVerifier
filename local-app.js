console.log(`>>> local-app.js execution started <<<`);

// local-app.js - Standalone Node.js TUI Application

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

// --- Configuration Loading & Saving ---
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let settings = {};

function loadSettings() {
    try {
        console.log(`[App] Loading settings from ${SETTINGS_FILE}`);
        if (fs.existsSync(SETTINGS_FILE)) {
            const rawData = fs.readFileSync(SETTINGS_FILE);
            settings = JSON.parse(rawData.toString());
            console.log(`[App] Settings loaded successfully:`, settings);
        } else {
            console.warn(`[App] Settings file not found at ${SETTINGS_FILE}. Using defaults.`);
            settings = {
                mqttBroker: "192.168.5.5",
                mqttPort: 1883,
                mqttVerifyTopic: "Tekpak/F6/BarcodeVerifier",
                mqttClientId: "PiLocalApp",
                rejectDelay: 3000
            };
            saveSettings();
        }
    } catch (error) {
        console.error(`[App] Error loading settings:`, error);
        process.exit(1);
    }
}

function saveSettings() {
    try {
        console.log(`[App] Saving settings to ${SETTINGS_FILE}`);
        delete settings.productSensorPin;
        delete settings.rejectOutputPin;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error(`[App] Error saving settings:`, error);
    }
}

// --- Global State ---
let currentMqttStatus = 'Disconnected';
let lastBarcode = null;
let lastResult = null;

// --- MQTT Client Setup ---
let mqttClient = null;

function connectMqtt() {
    if (mqttClient && mqttClient.connected) {
        console.log(`[MQTT] Already connected.`);
        return;
    }
    if (mqttClient) {
        mqttClient.end(true);
    }
    
    const connectUrl = `mqtt://${settings.mqttBroker}:${settings.mqttPort}`;
    const options = {
        clientId: settings.mqttClientId,
        clean: true, // Start with a clean session
        connectTimeout: 4000 // Slightly shorter timeout
        // Removed reconnectPeriod to see if default behavior is better
    };

    console.log(`[MQTT] Attempting connection to ${connectUrl} with options:`, options);
    currentMqttStatus = 'Connecting...';
    mqttClient = mqtt.connect(connectUrl, options); // Use URL string and options object

    mqttClient.on('connect', () => {
        console.log(`[MQTT] Connected to MQTT Broker: ${settings.mqttBroker}:${settings.mqttPort}`);
        currentMqttStatus = 'Connected';
    });
    mqttClient.on('error', (err) => {
        console.error(`[MQTT] Connection Error:`, err);
        currentMqttStatus = 'Error';
    });
    mqttClient.on('close', () => {
        console.log(`[MQTT] Client Disconnected.`);
        currentMqttStatus = 'Disconnected';
    });
    mqttClient.on('offline', () => {
        console.warn(`[MQTT] Client Offline`);
        currentMqttStatus = 'Disconnected';
    });
    // Removed reconnect listener to simplify
    // mqttClient.on('reconnect', () => { ... }); 
    // No message handling needed
}

// --- GPIO Setup & Logic (Removed) ---

// --- Barcode Scanning ---
let barcodeBuffer = '';
process.stdin.setEncoding('utf8');
if (process.stdin.isTTY) {
    try {
         process.stdin.setRawMode(true);
    } catch (e) {
        console.warn(`[App] Could not set raw mode on stdin:`, e.message);
    }
}
process.stdin.on('readable', () => {
  let chunk;
  try {
    while ((chunk = process.stdin.read()) !== null) {
      if (chunk === '\u0003') { // Ctrl+C
        cleanupAndExit(0);
      }
      if (chunk === '\r' || chunk === '\n') { // Enter key
          handleScan(barcodeBuffer.trim());
          barcodeBuffer = '';
      } else {
          barcodeBuffer += chunk;
      }
    }
  } catch(e) {
      console.error(`[App] Error reading stdin:`, e.message);
  }
});

function handleScan(scannedBarcode) {
    if (!scannedBarcode) return;
    console.log(`[App] handleScan called with:`, scannedBarcode);
    lastBarcode = scannedBarcode;
    const isValid = isValidGTIN(scannedBarcode);
    lastResult = isValid ? "PASS" : "FAIL";
    console.log(`[App] Verification Result: ${lastResult}`);
    // TODO: Update TUI
    publishMqttMessage(mqttClient, settings.mqttVerifyTopic, lastResult);
    // No GPIO reject logic
}

function isValidGTIN(barcode) {
  // Basic GTIN format validation (12-14 digits)
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
function setupTUI() {
    console.log(`
--- TUI Placeholder ---`);
    console.log(`TODO: Implement Terminal User Interface here.`);
    console.log(`Press Ctrl+C to exit.`);
    setInterval(() => {
        // Simplified status log
        console.log(`Status Update | MQTT: ${currentMqttStatus} | Last Scan: ${lastBarcode || 'None'} | Result: ${lastResult || 'N/A'}`);
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
    const attemptExit = () => {
        if (mqttClosed) { 
            console.log(`[App] Cleanup complete. Exiting.`);
            process.exit(exitCode);
        }
    };
    
    const gpioCleaned = true; // GPIO is disabled

    if (mqttClient) {
        mqttClient.end(true, () => {
            console.log(`[MQTT] Client disconnected.`);
            mqttClosed = true;
            attemptExit();
        });
        setTimeout(() => {
            if (!mqttClosed) {
                console.warn(`[MQTT] Client did not close gracefully, forcing exit.`);
                mqttClosed = true;
                attemptExit();
            }
        }, 2000);
    } else {
        mqttClosed = true;
    }
    if (process.stdin.isTTY && process.stdin.isRaw) {
        try { 
             process.stdin.setRawMode(false);
        } catch(e) {
            console.warn(`[App] Could not reset raw mode on stdin:`, e.message);
        }
    }
    process.stdin.pause();
    attemptExit(); 
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('uncaughtException', (err) => {
    console.error(`[App] Uncaught Exception:`, err);
    cleanupAndExit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error(`[App] Unhandled Rejection at:`, promise, 'reason:', reason);
    cleanupAndExit(1);
});

// --- Initialization ---
loadSettings();
// initializeGpio(); // GPIO initialization is commented out
connectMqtt();    // Connect to MQTT
setupTUI();      // Placeholder for TUI setup

console.log(`[App] Local application started (GPIO functionality disabled).`);
