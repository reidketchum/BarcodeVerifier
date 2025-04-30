console.log(`>>> local-app.js execution started <<<`);

// local-app.js - Standalone Node.js TUI Application

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const blessed = require('blessed');
// const { Gpio } = require('onoff'); // Keep GPIO disabled for now

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
        // Ensure default values exist if loaded settings are incomplete
        settings.mqttBroker = settings.mqttBroker || "192.168.5.5";
        settings.mqttPort = settings.mqttPort || 1883;
        settings.mqttVerifyTopic = settings.mqttVerifyTopic || "Tekpak/F6/BarcodeVerifier";
        settings.mqttClientId = settings.mqttClientId || "PiLocalApp";
        settings.rejectDelay = settings.rejectDelay || 3000;

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

// --- TUI Elements --- 
let screen; 
let dashboardBox;
let settingsBox;
let logBox;
let mqttStatusElement;
let lastBarcodeElement;
let lastResultElement;
let caseDetectedElement; // Re-add for placeholder
let rejectStateElement;  // Re-add for placeholder
let settingsForm;
let brokerInput, portInput, topicInput, clientIdInput, delayInput;

let logMessages = [];
const MAX_LOG_LINES = 100; // Limit log lines displayed

// --- Global State ---
let currentMqttStatus = 'Disconnected';
let lastBarcode = null;
let lastResult = null;
// Add back for TUI display, even if not driven by real GPIO yet
let isCaseDetected = false; 
let rejectOutputState = 'Inactive';

// --- MQTT Client Setup ---
let mqttClient = null;

function connectMqtt() {
    if (mqttClient && mqttClient.connected) { return; }
    if (mqttClient) { mqttClient.end(true); }
    
    const connectUrl = `mqtt://${settings.mqttBroker}:${settings.mqttPort}`;
    const options = {
        clientId: settings.mqttClientId,
        clean: true,
        connectTimeout: 4000
    };

    log(`[MQTT] Attempting connection to ${connectUrl}...`);
    updateMqttStatus('Connecting...');
    mqttClient = mqtt.connect(connectUrl, options);

    mqttClient.on('connect', () => {
        log(`[MQTT] Connected to MQTT Broker: ${settings.mqttBroker}:${settings.mqttPort}`);
        updateMqttStatus('Connected');
        // No subscriptions needed in this version
    });
    mqttClient.on('error', (err) => {
        log(`[MQTT] Connection Error: ${err.message}`);
        updateMqttStatus('Error');
    });
    mqttClient.on('close', () => {
        log(`[MQTT] Client Disconnected.`);
        updateMqttStatus('Disconnected');
    });
    mqttClient.on('offline', () => {
        log(`[MQTT] Client Offline`);
        updateMqttStatus('Disconnected');
    });
}

// --- GPIO Setup & Logic (Removed) ---

// --- Barcode Scanning (using stdin) ---
let barcodeBuffer = '';
let inputCaptureActive = true; // To control when stdin is processed

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
          // Only process barcode if input capture is active (not editing settings)
          if (inputCaptureActive) {
              if (chunk === '\n' || chunk === '\r') { // Enter key
                  handleScan(barcodeBuffer.trim());
                  barcodeBuffer = '';
              } else {
                  barcodeBuffer += chunk;
                  // Optionally echo to log or a dedicated input display element in TUI
                  log(`Key pressed: ${chunk}`); 
              }
          } else {
             // Input is being handled by focused element (e.g., settings form)
             // Blessed handles this automatically for form inputs
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
    publishMqttMessage(mqttClient, settings.mqttVerifyTopic, lastResult);
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
        fullUnicode: true, // Support unicode characters
        autoPadding: true
    });

    // Main layout box
    const layout = blessed.layout({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        layout: 'grid' // Use grid layout
    });

    // --- Dashboard Box ---
    dashboardBox = blessed.box({
        parent: layout,
        label: ' Dashboard ',
        top: 0,
        left: 0,
        width: '50%',
        height: '50%',
        border: 'line',
        style: { border: { fg: 'cyan' } }
    });

    mqttStatusElement = blessed.text({ parent: dashboardBox, top: 1, left: 2, content: `MQTT Status: ${currentMqttStatus}` });
    caseDetectedElement = blessed.text({ parent: dashboardBox, top: 2, left: 2, content: `Sensor State: ${isCaseDetected ? 'Detected' : 'Not Detected'} (Simulated)`}); // Placeholder
    rejectStateElement = blessed.text({ parent: dashboardBox, top: 3, left: 2, content: `Reject State: ${rejectOutputState} (Simulated)`}); // Placeholder
    lastBarcodeElement = blessed.text({ parent: dashboardBox, top: 5, left: 2, height: 2, width: '90%', content: `Last Barcode: ${lastBarcode || 'None'}`});
    lastResultElement = blessed.text({ parent: dashboardBox, top: 7, left: 2, content: `Last Result: ${lastResult || 'N/A'}`});

    // --- Settings Box ---
    settingsBox = blessed.box({
        parent: layout,
        label: ' Settings (Press TAB to focus, ENTER to submit) ',
        top: 0,
        left: '50%',
        width: '50%',
        height: '50%',
        border: 'line',
        style: { border: { fg: 'yellow' } }
    });

    settingsForm = blessed.form({
        parent: settingsBox,
        keys: true, // Enable key handling
        vi: true, // Use vi keys if desired
        width: '95%',
        height: '80%',
        top: 1, 
        left: 2
    });

    // Add form elements programmatically
    let currentTop = 0;
    const addSetting = (label, initialValue, stateSetter) => {
        blessed.text({ parent: settingsForm, top: currentTop, left: 0, content: label });
        const input = blessed.textbox({
            parent: settingsForm,
            name: label.toLowerCase().replace(/ /g, ''),
            inputOnFocus: true,
            height: 1,
            width: '60%',
            left: 25,
            top: currentTop,
            value: initialValue.toString(),
            border: { type: 'line' },
            style: { focus: { border: { fg: 'blue' } } }
        });
        input.on('focus', () => inputCaptureActive = false);
        input.on('blur', () => inputCaptureActive = true);
        currentTop += 2;
        return input;
    };

    brokerInput = addSetting('Broker Addr:', settings.mqttBroker);
    portInput = addSetting('Broker Port:', settings.mqttPort);
    topicInput = addSetting('Verify Topic:', settings.mqttVerifyTopic);
    clientIdInput = addSetting('Client ID:', settings.mqttClientId);
    delayInput = addSetting('Reject Delay:', settings.rejectDelay); 

    const submitButton = blessed.button({
        parent: settingsForm,
        content: 'Save Settings',
        top: currentTop,
        left: 0,
        width: 15,
        height: 1,
        shrink: true,
        style: { focus: { bold: true, bg: 'blue' }, hover: { bg: 'lightgrey' } },
        border: 'line',
        mouse: true,
        keys: true
    });

    submitButton.on('press', () => {
        settingsForm.submit();
    });

    settingsForm.on('submit', (data) => {
        log("[App] Settings form submitted:", data);
        settings.mqttBroker = data['brokeraddr:'] || settings.mqttBroker;
        settings.mqttPort = parseInt(data['brokerport:'], 10) || settings.mqttPort;
        settings.mqttVerifyTopic = data['verifytopic:'] || settings.mqttVerifyTopic;
        settings.mqttClientId = data['clientid:'] || settings.mqttClientId;
        settings.rejectDelay = parseInt(data['rejectdelay:'], 10) || settings.rejectDelay;
        saveSettings();
        log("[App] Settings saved. Reconnecting MQTT...");
        updateSettingsDisplay(); // Update display immediately
        connectMqtt(); // Reconnect with new settings
        screen.render();
        inputCaptureActive = true; // Ensure input capture is re-enabled
        dashboardBox.focus(); // Return focus to dashboard or log
    });

    // --- Log Box ---
    logBox = blessed.log({
        parent: layout,
        label: ' Log Output ',
        top: '50%',
        left: 0,
        width: '100%',
        height: '50%',
        border: 'line',
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { ch: ' ', bg: 'blue' },
        keys: true,
        vi: true,
        mouse: true,
        style: { border: { fg: 'green' } }
    });

    // --- Key Bindings ---
    screen.key(['escape', 'q', 'C-c'], function(ch, key) {
        return cleanupAndExit(0);
    });
    
    // Basic focus switching (can be improved)
    let focusIndex = 0;
    const focusable = [dashboardBox, settingsForm, logBox];
    screen.key(['tab'], function(ch, key) {
         focusIndex = (focusIndex + 1) % focusable.length;
         focusable[focusIndex].focus();
         // If focusing form, make sure first element gets focus
         if (focusable[focusIndex] === settingsForm) {
            settingsForm.focusFirst();
            inputCaptureActive = false; // Disable barcode capture when form focused
         } else {
            inputCaptureActive = true;
         }
    });
    screen.key(['S-tab'], function(ch, key) { // Shift+Tab
        focusIndex = (focusIndex - 1 + focusable.length) % focusable.length;
        focusable[focusIndex].focus();
         if (focusable[focusIndex] === settingsForm) {
            settingsForm.focusFirst();
            inputCaptureActive = false;
         } else {
            inputCaptureActive = true;
         }
    });

    // Initial render
    updateUIDisplay(); // Update with initial state
    screen.render();
    dashboardBox.focus(); // Start focus on dashboard
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

function updateSettingsDisplay() {
    if (brokerInput) brokerInput.setValue(settings.mqttBroker);
    if (portInput) portInput.setValue(settings.mqttPort.toString());
    if (topicInput) topicInput.setValue(settings.mqttVerifyTopic);
    if (clientIdInput) clientIdInput.setValue(settings.mqttClientId);
    if (delayInput) delayInput.setValue(settings.rejectDelay.toString());
}

// Central logging function to update TUI log box
function log(...args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
    console.log(message); // Keep logging to console for PM2 logs
    if (logBox) {
        logMessages.push(message);
        if (logMessages.length > MAX_LOG_LINES) {
            logMessages.shift(); // Remove oldest line
        }
        logBox.setLines(logMessages); // Use setLines for efficient updates
        logBox.scroll(logMessages.length); // Scroll to bottom
        screen.render();
    }
}

// Update all TUI elements
function updateUIDisplay() {
    if (!screen) return; // TUI not setup yet
    updateMqttStatus(currentMqttStatus);
    updateLastBarcode(lastBarcode);
    updateLastResult(lastResult);
    // Update placeholder GPIO displays if elements exist
    if(caseDetectedElement) caseDetectedElement.setContent(`Sensor State: ${isCaseDetected ? 'Detected' : 'Not Detected'} (Simulated)`);
    if(rejectStateElement) rejectStateElement.setContent(`Reject State: ${rejectOutputState} (Simulated)`);
    updateSettingsDisplay();
    screen.render();
}

// --- Graceful Shutdown ---
let isExiting = false;
function cleanupAndExit(exitCode = 0) {
    if (isExiting) return;
    isExiting = true;
    log(`
[App] Shutting down... (Exit Code: ${exitCode})`);
    let mqttClosed = false;
    const attemptExit = () => {
        if (mqttClosed) { 
            log("[App] Cleanup complete. Exiting.");
            if (screen) screen.destroy(); // Destroy blessed screen
            process.exit(exitCode);
        }
    };
    
    const gpioCleaned = true; // GPIO is disabled

    if (mqttClient) {
        mqttClient.end(true, () => {
            log('[MQTT] Client disconnected.');
            mqttClosed = true;
            attemptExit();
        });
        setTimeout(() => {
            if (!mqttClosed) {
                log('[MQTT] Client did not close gracefully, forcing exit.');
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
    console.error(err); // Also log full error to stderr
    cleanupAndExit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    log(`[App] Unhandled Rejection at: ${promise}, reason: ${reason}`);
    console.error(reason);
    cleanupAndExit(1);
});

// --- Initialization ---
loadSettings();
setupTUI(); // Setup TUI first
connectMqtt(); // Connect to MQTT
// initializeGpio(); // GPIO initialization is commented out

log('[App] Local application started (GPIO functionality disabled).');
