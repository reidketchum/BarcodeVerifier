console.log(`>>> local-app.js execution started <<<`);

// local-app.js - Standalone Node.js TUI Application

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const blessed = require('blessed');
const rpio = require('rpio'); // Use rpio

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
                rejectDelay: 3000,
                productSensorPin: 17, 
                rejectOutputPin: 27
            };
            saveSettings();
        }
        settings.mqttBroker = settings.mqttBroker || "192.168.5.5";
        settings.mqttPort = settings.mqttPort || 1883;
        settings.mqttVerifyTopic = settings.mqttVerifyTopic || "Tekpak/F6/BarcodeVerifier";
        settings.mqttClientId = settings.mqttClientId || "PiLocalApp";
        settings.rejectDelay = settings.rejectDelay || 3000;
        settings.productSensorPin = settings.productSensorPin || 17;
        settings.rejectOutputPin = settings.rejectOutputPin || 27;

    } catch (error) {
        console.error(`[App] Error loading settings:`, error);
        // Don't exit on settings load error, allow app to start with defaults
        // process.exit(1);
    }
}

function saveSettings() {
    try {
        console.log(`[App] Saving settings to ${SETTINGS_FILE}`);
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error(`[App] Error saving settings:`, error);
    }
}

// --- TUI Elements --- 
let screen; 
let dashboardBox;
let settingsBox;
let logBox;
let mqttStatusElement;
let lastBarcodeElement;
let lastResultElement;
let caseDetectedElement; 
let rejectStateElement;  
let settingsForm;
let brokerInput, portInput, topicInput, clientIdInput, delayInput, sensorPinInput, rejectPinInput;

 inputCaptureActive = true; 

// --- Global State ---
let currentMqttStatus = 'Disconnected';
let lastBarcode = null;
let lastResult = null;
let isCaseDetected = false; 
let rejectOutputState = 'Inactive'; 

// --- MQTT Client Setup ---
let mqttClient = null;
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; 
const REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command"; 

function connectMqtt() {
    if (mqttClient && mqttClient.connected) { return; }
    if (mqttClient) { mqttClient.end(true); }
    
    const connectUrl = `mqtt://${settings.mqttBroker}:${settings.mqttPort}`;
    const options = {
        clientId: settings.mqttClientId,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 5000 // Re-added reconnect period
    };

    log(`[MQTT] Attempting connection to ${connectUrl}...`);
    updateMqttStatus('Connecting...');
    mqttClient = mqtt.connect(connectUrl, options);

    mqttClient.on('connect', () => {
        log(`[MQTT] Connected to MQTT Broker: ${settings.mqttBroker}:${settings.mqttPort}`);
        updateMqttStatus('Connected');
        mqttClient.subscribe(REJECT_OUTPUT_COMMAND_TOPIC, { qos: 1 }, (err) => {
            if (!err) log(`[MQTT] Subscribed to topic: ${REJECT_OUTPUT_COMMAND_TOPIC}`);
            else log(`[MQTT] Failed to subscribe to ${REJECT_OUTPUT_COMMAND_TOPIC}: ${err.message}`);
        });
        // Also subscribe to the sensor state topic if needed for other displays
        // mqttClient.subscribe(PRODUCT_SENSOR_TOPIC, { qos: 1 }, (err) => { ... });
    });
    mqttClient.on('error', (err) => {
        log(`[MQTT] Connection Error: ${err.message}`);
        currentMqttStatus = 'Error';
    });
    mqttClient.on('close', () => {
        log(`[MQTT] Client Disconnected.`);
        updateMqttStatus('Disconnected');
    });
    mqttClient.on('offline', () => {
        log(`[MQTT] Client Offline`);
        currentMqttStatus = 'Disconnected';
    });
    mqttClient.on('reconnect', () => { // Keep reconnect listener
        log(`[MQTT] Client Attempting Reconnect`);
        updateMqttStatus('Connecting...');
    });

    // Handle incoming commands for reject output
    mqttClient.on('message', (topic, message) => {
        log(`[MQTT] Received message on topic ${topic}: ${message.toString()}`);
        if (topic === REJECT_OUTPUT_COMMAND_TOPIC) {
            const command = message.toString().toUpperCase();
            if (command === 'ACTIVATE') activateRejectOutput();
            else if (command === 'DEACTIVATE') deactivateRejectOutput();
        }
        // Handle incoming sensor state messages if subscribing to it
        // if (topic === PRODUCT_SENSOR_TOPIC) { ... }
    });
}

// --- GPIO Setup & Logic (using rpio) ---
rpioInitialized = false; // Flag to track if rpio was successfully initialized
let pollInterval = null; // Store poll interval ID

function initializeGpio() {
    log("[GPIO] Initialize function called.");
    try {
        // rpio.init(); // rpio is often initialized implicitly by open/read/write
        // No longer checking Gpio.accessible as we use rpio

        log(`[GPIO] Attempting to initialize pin ${settings.productSensorPin} as input...`);
        rpio.open(settings.productSensorPin, rpio.INPUT, rpio.PULL_UP); 
        log(`[GPIO] GPIO ${settings.productSensorPin} initialized for input.`);

        log(`[GPIO] Attempting to initialize pin ${settings.rejectOutputPin} as output...`);
        rpio.open(settings.rejectOutputPin, rpio.OUTPUT, rpio.LOW); 
        log(`[GPIO] GPIO ${settings.rejectOutputPin} initialized for output.`);
        rejectOutputState = 'Inactive';
        updateRejectStateDisplay();

        // Set up polling for the input pin
        pollInterval = setInterval(() => {
            const value = rpio.read(settings.productSensorPin);
            const newState = value === rpio.HIGH; 

            if (newState !== isCaseDetected) {
                 isCaseDetected = newState;
                 const stateString = isCaseDetected ? 'detected' : 'not detected';
                 log(`[GPIO] GPIO ${settings.productSensorPin} state changed to: ${stateString} (value: ${value})`);
                 updateSensorStateDisplay(); 
                 
                 // Publish state to MQTT from here
                 if (mqttClient && mqttClient.connected) {
                     publishMqttMessage(mqttClient, PRODUCT_SENSOR_TOPIC, stateString);
                 } else {
                     log('[MQTT] Client not connected, cannot publish sensor state.');
                 }

                 if (!isCaseDetected) {
                    lastBarcode = null;
                    lastResult = null;
                    updateLastBarcode(null);
                    updateLastResult(null);
                 }
            }
        }, 50); 

        rpioInitialized = true; // Mark as initialized after successful opens
        log('[GPIO] Initialization complete. Polling GPIO pin...');

    } catch (error) {
        log(`[GPIO] Failed to initialize GPIO: ${error.message}`);
        console.error(error); 
        rpioInitialized = false; 
        // Don't exit, allow app to run without GPIO
    }
}

function activateRejectOutput() {
    if (!rpioInitialized) { log('[GPIO] Reject output disabled (rpio not initialized).'); return; }
    if (rpio.read(settings.rejectOutputPin) === rpio.LOW) { 
        log('[GPIO] Activating reject output (GPIO HIGH)');
        rpio.write(settings.rejectOutputPin, rpio.HIGH);
        rejectOutputState = 'Active';
        updateRejectStateDisplay(); 

        setTimeout(() => {
            deactivateRejectOutput();
        }, settings.rejectDelay || 3000);
    } else {
         log('[GPIO] Reject output already active.');
    }
}

function deactivateRejectOutput() {
     if (!rpioInitialized) { log('[GPIO] Reject output disabled (rpio not initialized).'); return; }
     if (rpio.read(settings.rejectOutputPin) === rpio.HIGH) { 
        log('[GPIO] Deactivating reject output (GPIO LOW)');
        rpio.write(settings.rejectOutputPin, rpio.LOW);
        rejectOutputState = 'Inactive';
        updateRejectStateDisplay(); 
     } else {
         log('[GPIO] Reject output already inactive.');
     }
}

// --- Barcode Scanning ---
let barcodeBuffer = '';
let inputCaptureActive = true; 

function setupInputHandling() {
    process.stdin.setEncoding('utf8');
    if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(true); } 
        catch (e) { log(`[App] Warn: Could not set raw mode on stdin: ${e.message}`); }
    }
    process.stdin.on('readable', () => {
      let chunk;
      try {
        while ((chunk = process.stdin.read()) !== null) {
          if (chunk === '\u0003') { // Ctrl+C
            cleanupAndExit(0);
          }
          if (inputCaptureActive) {
              if (chunk === '\r' || chunk === '\n') { // Enter key
                  handleScan(barcodeBuffer.trim());
                  barcodeBuffer = '';
              } else {
                  barcodeBuffer += chunk;
              }
          } 
        }
      } catch(e) {
          log(`[App] Error reading stdin: ${e.message}`);
      }
    });
}

function handleScan(scannedBarcode) {
    if (!scannedBarcode) return;
    log(`[App] handleScan called with: ${scannedBarcode}`);
    updateLastBarcode(scannedBarcode);
    const isValid = isValidGTIN(scannedBarcode);
    updateLastResult(isValid ? "PASS" : "FAIL");
    // Publish result (Verify Publish Topic)
    if (mqttClient && mqttClient.connected) {
        publishMqttMessage(mqttClient, settings.mqttVerifyTopic, lastResult);
    } else {
        log('[MQTT] Client not connected, cannot publish verify result.');
    }
    // Trigger reject if needed (send command via MQTT)
    if (!isValid) {
        log('[App] Scan failed, sending ACTIVATE command for reject output.');
        if (mqttClient && mqttClient.connected) {
            publishMqttMessage(mqttClient, REJECT_OUTPUT_COMMAND_TOPIC, "ACTIVATE");
        } else {
             log('[MQTT] Client not connected, cannot send reject command.');
        }
    }
}

function isValidGTIN(barcode) {
  return /^\d{12,14}$/.test(barcode);
}

function publishMqttMessage(client, topic, message) {
    if (client && client.connected) {
        log(`[MQTT] Publishing: '${message}' to ${topic}`); 
        client.publish(topic, message, { qos: 1 }, (err) => {
            if (err) log(`[MQTT] Publish Error to ${topic}: ${err.message || err}`);
        });
    } else {
        log(`[MQTT] Not connected. Cannot publish to ${topic}.`);
    }
}

// --- TUI Implementation ---

function setupTUI() {
    screen = blessed.screen({
        smartCSR: true,
        title: 'Barcode Verifier TUI',
        fullUnicode: true,
        autoPadding: true
    });

    // Use a top-level box for layout control
    const mainBox = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
    });

    // Top container for Dashboard and Settings side-by-side
    const topContainer = blessed.box({
        parent: mainBox,
        top: 0,
        left: 0,
        width: '100%',
        height: '50%' // Top half of the main box
    });

    dashboardBox = blessed.box({
        parent: topContainer,
        label: ' Dashboard ',
        top: 0,
        left: 0,
        width: '50%',
        height: '100%',
        border: 'line',
        style: { border: { fg: 'cyan' } }
    });

    mqttStatusElement = blessed.text({ parent: dashboardBox, top: 1, left: 2, content: `MQTT Status: ${currentMqttStatus}` });
    caseDetectedElement = blessed.text({ parent: dashboardBox, top: 2, left: 2, content: `Sensor State: ${isCaseDetected ? 'Detected' : 'Not Detected'}`}); 
    rejectStateElement = blessed.text({ parent: dashboardBox, top: 3, left: 2, content: `Reject State: ${rejectOutputState}`}); 
    lastBarcodeElement = blessed.text({ parent: dashboardBox, top: 5, left: 2, height: 2, width: '90%', content: `Last Barcode: ${lastBarcode || 'None'}`});
    lastResultElement = blessed.text({ parent: dashboardBox, top: 7, left: 2, content: `Last Result: ${lastResult || 'N/A'}`});

    settingsBox = blessed.box({
        parent: topContainer,
        label: ' Settings (Press TAB to focus, ENTER to submit) ',
        top: 0,
        left: '50%',
        width: '50%',
        height: '100%',
        border: 'line',
        style: { border: { fg: 'yellow' } }
    });

    settingsForm = blessed.form({
        parent: settingsBox,
        keys: true,
        vi: true,
        width: '95%',
        height: '90%', // Adjusted height
        top: 1, 
        left: 2,
        // Added padding to help with input field visibility
        padding: { top: 0, right: 1, bottom: 0, left: 1 },
        // Added background for form area for contrast
        style: { bg: 'black' }
    });

    let currentTop = 0;
    const addSetting = (label, initialValue, name) => {
        blessed.text({ parent: settingsForm, top: currentTop, left: 0, content: label });
        const input = blessed.textbox({
            parent: settingsForm,
            name: name, 
            inputOnFocus: true,
            height: 1,
            width: '60%',
            left: 25,
            top: currentTop,
            value: initialValue.toString(),
            border: { type: 'line' },
            style: { 
                fg: 'white', // Set text color
                bg: 'blue', // Set background color for input
                focus: { border: { fg: 'blue' }, fg: 'white', bg: 'lightblue' } // Highlight on focus
            },
            // Added padding for the input box itself
            padding: { top: 0, right: 0, bottom: 0, left: 1 }
        });
        input.on('focus', () => { inputCaptureActive = false; screen.render(); });
        input.on('blur', () => { inputCaptureActive = true; screen.render(); });
        currentTop += 2;
        return input;
    };

    // Use explicit names for settings inputs
    brokerInput = addSetting('Broker Addr:', settings.mqttBroker, 'mqttBroker');
    portInput = addSetting('Broker Port:', settings.mqttPort, 'mqttPort');
    topicInput = addSetting('Verify Topic:', settings.mqttVerifyTopic, 'mqttVerifyTopic');
    clientIdInput = addSetting('Client ID:', settings.mqttClientId, 'mqttClientId');
    delayInput = addSetting('Reject Delay:', settings.rejectDelay, 'rejectDelay');
    sensorPinInput = addSetting('Sensor Pin:', settings.productSensorPin, 'productSensorPin'); 
    rejectPinInput = addSetting('Reject Pin:', settings.rejectOutputPin, 'rejectPin'); // Corrected name for form data

    const submitButton = blessed.button({
        parent: settingsForm,
        content: 'Save Settings',
        top: currentTop,
        left: 0,
        width: 15,
        height: 1,
        shrink: true,
        style: { 
            focus: { bold: true, bg: 'blue' }, 
            hover: { bg: 'lightgrey' },
            fg: 'white', // Button text color
            bg: 'green'  // Button background color
        },
        border: 'line',
        mouse: true,
        keys: true
    });

    submitButton.on('press', () => {
        settingsForm.submit();
    });

    settingsForm.on('submit', (data) => {
        log("[App] Settings form submitted:", data);
        // Update settings object from form data
        settings.mqttBroker = data.mqttBroker || settings.mqttBroker;
        settings.mqttPort = parseInt(data.mqttPort, 10) || settings.mqttPort;
        settings.mqttVerifyTopic = data.mqttVerifyTopic || settings.mqttVerifyTopic;
        settings.mqttClientId = data.clientid || settings.mqttClientId; // Corrected data key
        settings.rejectDelay = parseInt(data.rejectdelay, 10) || settings.rejectDelay;
        settings.productSensorPin = parseInt(data.sensorpin, 10) || settings.productSensorPin; // Corrected data key
        settings.rejectOutputPin = parseInt(data.rejectpin, 10) || settings.rejectOutputPin; // Corrected data key

        saveSettings();
        log("[App] Settings saved. Reinitializing GPIO and Reconnecting MQTT...");
        updateSettingsDisplay(); 
        
        // Reinitialize GPIO and reconnect MQTT with new settings
        // Cleanup and reinitialize GPIO/MQTT
        // Check if rpio was initialized before cleanup
        if (rpioInitialized) { 
             try{ rpio.exit(); log('[GPIO] rpio cleanup complete before reinit.'); } 
             catch(e) { log(`[GPIO] Error during rpio cleanup before reinit: ${e.message}`); }
             rpioInitialized = false; // Reset flag
        }
         if (mqttClient) { mqttClient.end(true); log('[MQTT] Client disconnected before reconnect.'); }

        // Re-run initialization after cleanup
        initializeGpio(); 
        connectMqtt();

        inputCaptureActive = true; 
        logBox.focus(); 
        screen.render(); 
    });

    // Log box takes the bottom half
    logBox = blessed.log({
        parent: mainBox,
        label: ' Log Output ',
        top: '50%', // Start at 50% height
        left: 0,
        width: '100%',
        height: '50%', // Take the remaining 50%
        border: 'line',
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', bg: 'blue' },
        keys: true,
        vi: true,
        mouse: true,
        style: { border: { fg: 'green' }, fg: 'white', bg: 'black' }, // White text on black background
        tags: true // Allow blessed formatting tags if needed later
    });

    screen.key(['escape', 'q', 'C-c'], (ch, key) => { cleanupAndExit(0); });
    
    let focusIndex = 0;
    const focusable = [logBox, settingsForm]; 
    screen.key(['tab'], (ch, key) => {
         focusIndex = (focusIndex + 1) % focusable.length;
         focusable[focusIndex].focus();
         if (focusable[focusIndex] === settingsForm) { inputCaptureActive = false; settingsForm.focusFirst(); }
         else { inputCaptureActive = true; }
         screen.render();
    });
    screen.key(['S-tab'], (ch, key) => {
        focusIndex = (focusIndex - 1 + focusable.length) % focusable.length;
        focusable[focusIndex].focus();
        if (focusable[focusIndex] === settingsForm) { inputCaptureActive = false; settingsForm.focusFirst(); }
        else { inputCaptureActive = true;
         screen.render();
    }});

    // Initial setup and display
    updateUIDisplay();
    screen.render();
    logBox.focus(); 
}

// --- UI Update Functions ---
function updateMqttStatus(status) {
    currentMqttStatus = status;
    if (mqttStatusElement) {
        mqttStatusElement.setContent(`MQTT Status: ${status}`);
        screen.render();
    }
}

function updateLastBarcode(barcode) {
    lastBarcode = barcode;
    if (lastBarcodeElement) {
        lastBarcodeElement.setContent(`Last Barcode: ${barcode || 'None'}`);
        screen.render();
    }
}

function updateLastResult(result) {
    lastResult = result;
    if (lastResultElement) {
        lastResultElement.setContent(`Last Result: ${result || 'N/A'}`);
        screen.render();
    }
}

function updateSensorStateDisplay() {
    if (caseDetectedElement) {
         caseDetectedElement.setContent(`Sensor State: ${isCaseDetected ? 'Detected' : 'Not Detected'}`);
         screen.render();
    }
}

function updateRejectStateDisplay() {
     if (rejectStateElement) {
         rejectStateElement.setContent(`Reject State: ${rejectOutputState}`);
         screen.render();
    }
}

function updateSettingsDisplay() {
    if (!settingsForm) return;
    if (brokerInput) brokerInput.setValue(settings.mqttBroker);
    if (portInput) portInput.setValue(settings.mqttPort.toString());
    if (topicInput) topicInput.setValue(settings.mqttVerifyTopic);
    if (clientIdInput) clientIdInput.setValue(settings.mqttClientId);
    if (delayInput) delayInput.setValue(settings.rejectDelay.toString());
    if (sensorPinInput) sensorPinInput.setValue(settings.productSensorPin.toString());
    if (rejectPinInput) rejectPinInput.setValue(settings.rejectOutputPin.toString());
}

// Central logging function
function log(...args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
    console.log(message); 
    if (logBox) {
        logBox.log(message); 
        // screen.render(); // Render is called by logBox.log internally
    }
}

// Update all TUI elements
function updateUIDisplay() {
    if (!screen) return; 
    updateMqttStatus(currentMqttStatus);
    updateLastBarcode(lastBarcode);
    updateLastResult(lastResult);
    updateSensorStateDisplay();
    updateRejectStateDisplay();
    updateSettingsDisplay();
    screen.render();
}

// --- Graceful Shutdown ---
let isExiting = false;
let rpioInitialized = false; // Added flag
function cleanupAndExit(exitCode = 0) {
    if (isExiting) return;
    isExiting = true;
    log(`
[App] Shutting down... (Exit Code: ${exitCode})`);
    let mqttClosed = false;
    let gpioCleaned = false; 

    const attemptExit = () => {
        if (mqttClosed && gpioCleaned) { 
            log("[App] Cleanup complete. Exiting.");
            if (screen) screen.destroy();
            process.exit(exitCode);
        }
    };
    
    // Cleanup GPIO (using rpio)
    log('[GPIO] Attempting GPIO cleanup...');
    try {
        if (rpioInitialized) { // Only try cleanup if rpio was initialized
             rpio.exit(); 
             log('[GPIO] rpio cleanup complete.');
        } else {
             log('[GPIO] rpio was not initialized, skipping cleanup.');
        }
        gpioCleaned = true;
    } catch(err) {
         log(`[GPIO] Error during rpio cleanup: ${err.message}`);
         console.error(err); 
         gpioCleaned = true; 
    }

    if (mqttClient) {
        mqttClient.end(true, () => {
            log(`[MQTT] Client disconnected.`);
            mqttClosed = true;
            attemptExit();
        });
        setTimeout(() => {
            if (!mqttClosed) {
                log(`[MQTT] Client did not close gracefully, forcing exit.`);
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
            log(`[App] Could not reset raw mode on stdin: ${e.message}`);
        }
    }
    process.stdin.pause();
    attemptExit(); 
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('uncaughtException', (err) => {
    log(`[App] Uncaught Exception: ${err}`);
    console.error(err);
    cleanupAndExit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    log(`[App] Unhandled Rejection at: ${promise}, reason: ${reason}`);
    console.error(reason);
    cleanupAndExit(1);
});

// --- Initialization ---
loadSettings();
setupInputHandling(); // Setup stdin handling
setupTUI(); // Setup TUI first
connectMqtt();    // Connect to MQTT
initializeGpio(); // Initialize GPIO (using rpio)

log('[App] Local application started.');
