"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import mqtt from "mqtt";
import { MqttClient } from "mqtt"; // Import MqttClient type for useRef

// Initial MQTT Configuration (used if nothing in localStorage)
const INITIAL_MQTT_BROKER = "192.166.5.5"; // Changed to 192.166
const INITIAL_MQTT_PORT = 9001; // Changed port to 9001
const INITIAL_MQTT_VERIFY_TOPIC = "Tekpak/F6/BarcodeVerifier";
const INITIAL_MQTT_CLIENT_ID = "BarcodeVerifier";
const PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"; // Topic for sensor state

// Keys for localStorage
const LS_MQTT_BROKER = 'mqttBroker';
const LS_MQTT_PORT = 'mqttPort';
const LS_MQTT_TOPIC = 'mqttVerifyTopic'; // Updated key for verify topic
const LS_MQTT_CLIENT_ID = 'mqttClientId';

// triggerGPIOOutput now updates a state variable
const triggerGPIOOutput = (setRejectOutputState: (state: 'Inactive' | 'Active') => void, isFail: boolean): void => {
    if (isFail) {
        console.log(`GPIO Output Triggered: FAIL`);
        setRejectOutputState('Active');
        // In a real scenario, you would control the GPIO pin here.
        // For simulation, we'll set it back to inactive after a short delay
        setTimeout(() => {
            setRejectOutputState('Inactive');
        }, 500); // Simulate active state for 500ms
    } else {
        console.log(`GPIO Output Triggered: No Action`);
        setRejectOutputState('Inactive');
    }
};

let barcodeBuffer: string = '';

function isValidGTIN(barcode: string): boolean {
  // Basic GTIN format validation (12-14 digits)
  return /^\d{12,14}$/.test(barcode);
}

// publishResult now accepts the client instance and topic
const publishResult = (client: MqttClient | null, topic: string, result: "PASS" | "FAIL") => {
    if (client && client.connected) {
        console.log(`[MQTT] Result before publishing: ${result} to topic ${topic}`); // Log the result right before publishing
        client.publish(topic, result, (err) => {
            if (err) {
                console.error(`[MQTT] Publish Error: ${err.message || err}`);
            }
        });
    } else {
        console.log("[MQTT] Not connected to MQTT broker. Cannot publish.");
    }
};

// Helper function to get initial state from localStorage or fallback
const getInitialState = <T,>(key: string, fallback: T): T => {
  // Check if running in a browser environment
  if (typeof window !== 'undefined') {
    const storedValue = localStorage.getItem(key);
    if (storedValue !== null) {
      try {
        // Attempt to parse if it looks like JSON (e.g., for numbers)
        // Simple values like strings don't need parsing
        return storedValue;
      } catch (error) {
        console.error(`Error parsing localStorage key "${key}":`, error);
        return fallback; // Fallback on parsing error
      }
    }
  }
  return fallback; // Fallback if not in browser or value not found
};

export default function Home() { 
  // Removed testMode state as it's no longer used for case detection
  const [rejectDelay, setRejectDelay] = useState(3000); // milliseconds
  const [barcode, setBarcode] = useState<string | null>(null);
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [caseDetected, setCaseDetected] = useState(false); // Will be updated via MQTT
  const [mqttStatus, setMqttStatus] = useState<'Connecting...' | 'Connected' | 'Disconnected' | 'Error'>('Disconnected'); // New state for MQTT status
  const [rejectOutputState, setRejectOutputState] = useState<'Inactive' | 'Active'>('Inactive'); // New state for reject output
  const [mqttErrorMessage, setMqttErrorMessage] = useState<string | null>(null); // New state for MQTT error message

  // State for MQTT Configuration - Initialize from localStorage or defaults
  const [mqttBroker, setMqttBroker] = useState<string>(() => getInitialState(LS_MQTT_BROKER, INITIAL_MQTT_BROKER));
  const [mqttPort, setMqttPort] = useState<string>(() => getInitialState(LS_MQTT_PORT, INITIAL_MQTT_PORT.toString()));
  const [mqttVerifyTopic, setMqttVerifyTopic] = useState<string>(() => getInitialState(LS_MQTT_TOPIC, INITIAL_MQTT_VERIFY_TOPIC)); // Use updated key
  const [mqttClientId, setMqttClientId] = useState<string>(() => getInitialState(LS_MQTT_CLIENT_ID, INITIAL_MQTT_CLIENT_ID));

  // Ref to hold the MQTT client instance
  const mqttClientRef = useRef<MqttClient | null>(null);

  // Effect to save MQTT config to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') { // Ensure localStorage is available
        localStorage.setItem(LS_MQTT_BROKER, mqttBroker);
        localStorage.setItem(LS_MQTT_PORT, mqttPort);
        localStorage.setItem(LS_MQTT_TOPIC, mqttVerifyTopic); // Save verify topic
        localStorage.setItem(LS_MQTT_CLIENT_ID, mqttClientId);
    }
  }, [mqttBroker, mqttPort, mqttVerifyTopic, mqttClientId]);

  const handleKeyPress = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
        const scannedBarcode = barcodeBuffer.trim();
      handleScan(scannedBarcode);
      barcodeBuffer = ""; // Reset the buffer after processing
    } else {
      barcodeBuffer += event.key; // Append the pressed key to the buffer
    }
  };

  // handleScan now calls publishResult with the current client instance, topic and updates reject output state
  const handleScan = (scannedBarcode: string) => {
    if (!scannedBarcode) {
      return; // Do not run if the code is empty
    }
    console.log("handleScan called with:", scannedBarcode)
    setBarcode(scannedBarcode);
    const isValid = isValidGTIN(scannedBarcode);
    const currentResult: "PASS" | "FAIL" = isValid ? "PASS" : "FAIL";
    setResult(currentResult);
    publishResult(mqttClientRef.current, mqttVerifyTopic, currentResult); // Pass client instance and VERIFY topic
    if (!isValid) {
      triggerGPIOOutput(setRejectOutputState, true); // Pass setter to update state
    }
  };

  // Removed the useEffect hook that relied on testMode for case detection

  // Effect for MQTT client and keypress listener
  useEffect(() => {
    console.log("[MQTT] Running useEffect for MQTT connection, subscription, and keypress");
    setMqttStatus('Connecting...');
    setMqttErrorMessage(null);

    if (mqttClientRef.current) {
        console.log("[MQTT] Disconnecting previous client...");
        mqttClientRef.current.end(true); // Force close
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
    mqttClientRef.current = client; // Store client in ref
    console.log("[MQTT] Client Ref after connect:", mqttClientRef.current);

    client.on("connect", () => {
      console.log("[MQTT] Client Connected");
      setMqttStatus('Connected');
      setMqttErrorMessage(null);
      // Subscribe to the product sensor state topic
      client.subscribe(PRODUCT_SENSOR_TOPIC, (err) => {
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

    // Handle incoming messages (including sensor state)
    client.on('message', (topic, message) => {
        console.log(`[MQTT] Received message on ${topic}: ${message.toString()}`);
        if (topic === PRODUCT_SENSOR_TOPIC) {
            const state = message.toString();
            // Update caseDetected based on the received state message
            setCaseDetected(state === 'detected'); // Assuming 'detected' or 'not detected'
            console.log(`[UI] caseDetected state updated to: ${state === 'detected'}`);
        }
    });

    window.addEventListener("keypress", handleKeyPress);

    // Cleanup function 
    return () => {
      console.log("[MQTT] Running cleanup for MQTT and keypress");
      window.removeEventListener("keypress", handleKeyPress);
      if (mqttClientRef.current) {
        // Unsubscribe before closing
        mqttClientRef.current.unsubscribe(PRODUCT_SENSOR_TOPIC, (err) => {
          if(err) console.error("[MQTT] Unsubscribe error:", err);
          else console.log("[MQTT] Unsubscribed from", PRODUCT_SENSOR_TOPIC);
          // End connection after unsubscribe attempt
          mqttClientRef.current?.end(true, () => { // Use optional chaining and callback
              console.log("[MQTT] Client Disconnected (cleanup complete)");
          });
          mqttClientRef.current = null; // Clear the ref
        });
      } else {
         mqttClientRef.current = null; // Clear the ref if already null
      }
    };
  }, [mqttBroker, mqttPort, mqttTopic, mqttClientId, mqttVerifyTopic]); // Include verify topic in dependencies

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-2xl font-bold mb-4">CaseVerify Pi</h1>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Configuration</h2>
        </CardHeader>
        {/* Removed Test Mode Switch as caseDetected is now driven by MQTT */}
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
                <Label htmlFor="mqtt-topic">Verify Publish Topic</Label> { /* Renamed Label */}
                <Input
                  id="mqtt-topic"
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
            {/* Update display text to be clearer */}
            <p>GPIO 17 (Placeholder) - State: {caseDetected ? 'Detected' : 'Not Detected'}</p>
          </div>
          <div className="grid gap-2">
            <Label>Reject Output GPIO:</Label>
            <p>GPIO 27 (Placeholder) - State: {rejectOutputState}</p>
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
