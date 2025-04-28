"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
// Removed Switch import as Test Mode is removed
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import mqtt from "mqtt";
import { MqttClient } from "mqtt"; // Import MqttClient type for useRef

// Initial MQTT Configuration (used if nothing in localStorage)
const INITIAL_MQTT_BROKER = "192.166.5.5";
const INITIAL_MQTT_PORT = 9001;
const INITIAL_MQTT_VERIFY_TOPIC = "Tekpak/F6/BarcodeVerifier";
const INITIAL_MQTT_CLIENT_ID = "BarcodeVerifierUI"; // Renamed for clarity
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; // Topic for subscribing to sensor state
const REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command"; // Topic for publishing reject command

// Keys for localStorage
const LS_MQTT_BROKER = 'mqttBroker';
const LS_MQTT_PORT = 'mqttPort';
const LS_MQTT_VERIFY_TOPIC = 'mqttVerifyTopic';
const LS_MQTT_CLIENT_ID = 'mqttClientId';

// Removed simulateGPIODetection as it's no longer used

// Removed triggerGPIOOutput as reject command will be sent via MQTT

let barcodeBuffer: string = '';

function isValidGTIN(barcode: string): boolean {
  // Basic GTIN format validation (12-14 digits)
  return /^\d{12,14}$/.test(barcode);
}

// Function to publish MQTT messages (can be used for verify result and reject command)
const publishMqttMessage = (client: MqttClient | null, topic: string, message: string) => {
    if (client && client.connected) {
        console.log(`[MQTT] Publishing message: ${message} to topic ${topic}`); 
        client.publish(topic, message, { qos: 1 }, (err) => { // Added QoS for reliability
            if (err) {
                console.error(`[MQTT] Publish Error to ${topic}: ${err.message || err}`);
            }
        });
    } else {
        console.log(`[MQTT] Not connected to MQTT broker. Cannot publish to ${topic}.`);
    }
};

// Helper function to get initial state from localStorage or fallback
const getInitialState = <T,>(key: string, fallback: T): T => {
  if (typeof window !== 'undefined') {
    const storedValue = localStorage.getItem(key);
    if (storedValue !== null) {
      try {
        return storedValue;
      } catch (error) {
        console.error(`Error parsing localStorage key "${key}":`, error);
        return fallback;
      }
    }
  }
  return fallback;
};

export default function Home() { 
  // Removed testMode state
  const [rejectDelay, setRejectDelay] = useState(3000); // This might still be useful for UI logic, but not directly for GPIO
  const [barcode, setBarcode] = useState<string | null>(null);
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [caseDetected, setCaseDetected] = useState(false); // Now updated via MQTT subscription
  const [mqttStatus, setMqttStatus] = useState<'Connecting...' | 'Connected' | 'Disconnected' | 'Error'>('Disconnected'); 
  // Removed rejectOutputState as physical state comes from background service
  const [mqttErrorMessage, setMqttErrorMessage] = useState<string | null>(null);

  // State for MQTT Configuration - Initialize from localStorage or defaults
  const [mqttBroker, setMqttBroker] = useState<string>(() => getInitialState(LS_MQTT_BROKER, INITIAL_MQTT_BROKER));
  const [mqttPort, setMqttPort] = useState<string>(() => getInitialState(LS_MQTT_PORT, INITIAL_MQTT_PORT.toString()));
  const [mqttVerifyTopic, setMqttVerifyTopic] = useState<string>(() => getInitialState(LS_MQTT_VERIFY_TOPIC, INITIAL_MQTT_VERIFY_TOPIC)); 
  const [mqttClientId, setMqttClientId] = useState<string>(() => getInitialState(LS_MQTT_CLIENT_ID, INITIAL_MQTT_CLIENT_ID));

  // Ref to hold the MQTT client instance
  const mqttClientRef = useRef<MqttClient | null>(null);

  // Effect to save MQTT config to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') { 
        localStorage.setItem(LS_MQTT_BROKER, mqttBroker);
        localStorage.setItem(LS_MQTT_PORT, mqttPort);
        localStorage.setItem(LS_MQTT_VERIFY_TOPIC, mqttVerifyTopic); 
        localStorage.setItem(LS_MQTT_CLIENT_ID, mqttClientId);
    }
  }, [mqttBroker, mqttPort, mqttVerifyTopic, mqttClientId]);

  const handleKeyPress = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
        const scannedBarcode = barcodeBuffer.trim();
      handleScan(scannedBarcode);
      barcodeBuffer = ""; 
    } else {
      barcodeBuffer += event.key; 
    }
  };

  // handleScan now publishes verify result and reject command via MQTT
  const handleScan = (scannedBarcode: string) => {
    if (!scannedBarcode) {
      return; 
    }
    if (!caseDetected) { // Only process scan if case is detected
      console.log("Scan ignored: No case detected.");
      setBarcode(scannedBarcode); // Show scanned barcode even if ignored
      setResult(null); // Clear previous result
      return;
    }
    console.log("handleScan called with:", scannedBarcode);
    setBarcode(scannedBarcode);
    const isValid = isValidGTIN(scannedBarcode);
    const currentResult: "PASS" | "FAIL" = isValid ? "PASS" : "FAIL";
    setResult(currentResult);
    // Publish the verification result
    publishMqttMessage(mqttClientRef.current, mqttVerifyTopic, currentResult);
    // If invalid, publish command to activate reject output
    if (!isValid) {
      console.log("[UI] Scan failed, sending ACTIVATE command for reject output.");
      publishMqttMessage(mqttClientRef.current, REJECT_OUTPUT_COMMAND_TOPIC, "ACTIVATE");
      // Optionally send DEACTIVATE after rejectDelay, though the background service might handle this
      // setTimeout(() => {
      //   publishMqttMessage(mqttClientRef.current, REJECT_OUTPUT_COMMAND_TOPIC, "DEACTIVATE");
      // }, rejectDelay);
    }
  };

  // Effect for MQTT client connection, subscriptions, and keypress listener
  useEffect(() => {
    console.log("[MQTT] Running useEffect for MQTT connection, subscription, and keypress");
    setMqttStatus('Connecting...');
    setMqttErrorMessage(null);

    if (mqttClientRef.current) {
        console.log("[MQTT] Disconnecting previous client...");
        mqttClientRef.current.end(true);
        mqttClientRef.current = null;
    }

    console.log(`[MQTT] Attempting to connect to ${mqttBroker}:${mqttPort} using WebSocket`);

    const parsedPort = parseInt(mqttPort, 10);
    if (isNaN(parsedPort)) {
        console.error("[MQTT] Invalid port number:", mqttPort);
        setMqttStatus('Error');
        setMqttErrorMessage('Invalid port number');
        return; 
    }

    const client = mqtt.connect({
        host: mqttBroker,
        port: parsedPort,
        clientId: mqttClientId,
        protocol: 'ws' 
    });
    mqttClientRef.current = client;
    console.log("[MQTT] Client Ref after connect:", mqttClientRef.current);

    client.on("connect", () => {
      console.log("[MQTT] Client Connected");
      setMqttStatus('Connected');
      setMqttErrorMessage(null);
      // Subscribe to the product sensor state topic
      client.subscribe(PRODUCT_SENSOR_TOPIC, { qos: 1 }, (err) => { // Added QoS
        if (!err) {
          console.log(`[MQTT] Subscribed to topic: ${PRODUCT_SENSOR_TOPIC}`);
        } else {
          console.error(`[MQTT] Subscription error to ${PRODUCT_SENSOR_TOPIC}:`, err);
          setMqttStatus('Error');
          setMqttErrorMessage(`Subscription failed: ${err.message}`);
        }
      });
    });

    client.on("error", (err) => {
        console.error("[MQTT] Error:", err);
        setMqttStatus('Error');
        setMqttErrorMessage(err.message || 'An unknown MQTT error occurred');
    });

    client.on("close", (hadError) => {
        console.log("[MQTT] Client Disconnected. Had Error:", hadError);
        setMqttStatus('Disconnected');
         if (hadError) {
             setMqttErrorMessage('Disconnected due to error');
         }
    });
    
    client.on("offline", () => {
        console.log("[MQTT] Client Offline");
        setMqttStatus('Disconnected');
        setMqttErrorMessage('Client is offline');
    });

    // Handle incoming messages (only sensor state now)
    client.on('message', (topic, message) => {
        console.log(`[MQTT] Received message on ${topic}: ${message.toString()}`);
        if (topic === PRODUCT_SENSOR_TOPIC) {
            const state = message.toString().toLowerCase(); // Ensure consistent casing
            // Update caseDetected based on the received state message
            const detected = (state === 'detected' || state === 'high' || state === '1');
            setCaseDetected(detected);
            console.log(`[UI] caseDetected state updated to: ${detected} based on message: ${state}`);
            // Reset barcode/result when case is no longer detected
            if (!detected) {
                setBarcode(null);
                setResult(null);
            }
        }
    });

    window.addEventListener("keypress", handleKeyPress);

    // Cleanup function 
    return () => {
      console.log("[MQTT] Running cleanup for MQTT and keypress");
      window.removeEventListener("keypress", handleKeyPress);
      if (mqttClientRef.current) {
        mqttClientRef.current.unsubscribe(PRODUCT_SENSOR_TOPIC, (err) => {
          if(err) console.error("[MQTT] Unsubscribe error:", err);
          else console.log("[MQTT] Unsubscribed from", PRODUCT_SENSOR_TOPIC);
          mqttClientRef.current?.end(true, () => { 
              console.log("[MQTT] Client Disconnected (cleanup complete)");
          });
          mqttClientRef.current = null; 
        });
      } else {
         mqttClientRef.current = null; 
      }
    };
  // Updated dependency array
  }, [mqttBroker, mqttPort, mqttVerifyTopic, mqttClientId]); 

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-2xl font-bold mb-4">CaseVerify Pi</h1>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Configuration</h2>
        </CardHeader>
        {/* Removed Test Mode Switch */}
        <CardContent className="grid gap-4">
           <div className="grid gap-2">
            <Label htmlFor="reject-delay">Reject Delay (ms)</Label>
            <Input
              id="reject-delay"
              type="number"
              value={rejectDelay}
              onChange={(e) => setRejectDelay(Number(e.target.value))}
            />
          </div>
        </CardContent>
        
        <Separator />

        <CardHeader>
           <h3 className="text-md font-semibold">MQTT Settings</h3>
        </CardHeader>

        <CardContent className="grid gap-4">
             <div className="grid gap-2">
                <Label htmlFor="mqtt-broker">Broker Address</Label>
                <Input
                  id="mqtt-broker"
                  type="text"
                  value={mqttBroker}
                  onChange={(e) => setMqttBroker(e.target.value)}
                />
             </div>
             <div className="grid gap-2">
                <Label htmlFor="mqtt-port">Broker Port</Label>
                <Input
                  id="mqtt-port"
                  type="number"
                  value={mqttPort}
                  onChange={(e) => setMqttPort(e.target.value)}
                />
             </div>
              <div className="grid gap-2">
                <Label htmlFor="mqtt-verify-topic">Verify Publish Topic</Label> { /* Updated Label */}
                <Input
                  id="mqtt-verify-topic" // Updated ID
                  type="text"
                  value={mqttVerifyTopic} // Use mqttVerifyTopic state
                  onChange={(e) => setMqttVerifyTopic(e.target.value)}
                />
             </div>
              <div className="grid gap-2">
                <Label htmlFor="mqtt-client-id">Client ID</Label>
                <Input
                  id="mqtt-client-id"
                  type="text"
                  value={mqttClientId}
                  onChange={(e) => setMqttClientId(e.target.value)}
                />
             </div>
             {/* Display MQTT Status and Error */}
              <div className="grid gap-2">
                <Label>MQTT Status:</Label>
                <p>{mqttStatus}</p>
                {mqttStatus === 'Error' && mqttErrorMessage && (
                  <p className="text-destructive text-sm mt-1">Error: {mqttErrorMessage}</p>
                )}
                 {mqttStatus === 'Disconnected' && mqttErrorMessage && (
                  <p className="text-destructive text-sm mt-1">Reason: {mqttErrorMessage}</p>
                )}
              {mqttStatus === 'Disconnected' && mqttErrorMessage === null && (
                  <p className="text-gray-500 text-sm mt-1">Attempting connection...</p>
              )}
              <p className="text-sm text-gray-500 mt-1">For browser clients, a WebSocket listener on the broker is often required.</p>


          </div>
        </CardContent>

        <Separator />

        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Product Sensor GPIO:</Label>
            {/* Updated display text */}
            <p>GPIO 17 (Placeholder) - State: {caseDetected ? 'Detected' : 'Not Detected'}</p>
          </div>
          <div className="grid gap-2">
            <Label>Reject Output GPIO:</Label>
            {/* Removed rejectOutputState display */}
            <p>GPIO 27 (Placeholder) - State: Controlled by background service</p>
          </div>
        </CardContent>
        <Separator />
        <CardHeader>
          <h2 className="text-lg font-semibold">Verification Results</h2>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Removed duplicate Case Detected display */}
          <div className="grid gap-2">
            <Label>Barcode:</Label>
            <p>{barcode || "No barcode scanned"}</p>
          </div>
          <div className="grid gap-2">
            <Label>Result (Scan a barcode using the USB Scanner):</Label>
            <p
              className={`font-bold text-xl ${result === "PASS"
                ? "text-accent"
                : result === "FAIL" ? "text-destructive" : ""
                }`
            }>{result || "Scan a barcode to receive a result"}</p>
          </div>
        </CardContent>
        
      </Card>
    </div>
  );
}
