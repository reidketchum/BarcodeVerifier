"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import mqtt from "mqtt";
import { MqttClient } from "mqtt"; // Import MqttClient type for useRef

// Initial MQTT Configuration (can be overridden in UI)
const INITIAL_MQTT_BROKER = "192.168.5.5";
const INITIAL_MQTT_PORT = 1883;
const INITIAL_MQTT_TOPIC = "Tekpak/F6/BarcodeVerifier";
const INITIAL_MQTT_CLIENT_ID = "BarcodeVerifier";

const simulateGPIODetection = (): boolean => {  
    // Simulate case detected by sensor
    return Math.random() > 0.5; 
};

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

export default function Home() { 
  const [testMode, setTestMode] = useState(false);
  const [rejectDelay, setRejectDelay] = useState(3000); // milliseconds
  const [barcode, setBarcode] = useState<string | null>(null);
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [caseDetected, setCaseDetected] = useState(false);
  const [mqttStatus, setMqttStatus] = useState<'Connecting...' | 'Connected' | 'Disconnected' | 'Error'>('Disconnected'); // New state for MQTT status
  const [rejectOutputState, setRejectOutputState] = useState<'Inactive' | 'Active'>('Inactive'); // New state for reject output
  const [mqttErrorMessage, setMqttErrorMessage] = useState<string | null>(null); // New state for MQTT error message

  // State for MQTT Configuration
  const [mqttBroker, setMqttBroker] = useState(INITIAL_MQTT_BROKER);
  const [mqttPort, setMqttPort] = useState(INITIAL_MQTT_PORT.toString()); // Store as string for input
  const [mqttTopic, setMqttTopic] = useState(INITIAL_MQTT_TOPIC);
  const [mqttClientId, setMqttClientId] = useState(INITIAL_MQTT_CLIENT_ID);

  // Ref to hold the MQTT client instance
  const mqttClientRef = useRef<MqttClient | null>(null);

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
    publishResult(mqttClientRef.current, mqttTopic, currentResult); // Pass client instance and topic
    if (!isValid) {
      triggerGPIOOutput(setRejectOutputState, true); // Pass setter to update state
    }
  };

  // Effect for case detection simulation
  useEffect(() => {
    const caseDetectionInterval = setInterval(() => {
      if (testMode) { // Removed || simulateGPIODetection()
        setCaseDetected(true);
        //handleScan(); // Simulate barcode scan on case detection
      } else {
        setCaseDetected(false);
        setBarcode(null);
        setResult(null);
      }
    }, 2000);

    return () => {
      clearInterval(caseDetectionInterval);
    };
  }, [testMode, rejectDelay]);

  // Effect for MQTT client and keypress listener
  useEffect(() => {
    console.log("[MQTT] Running useEffect for MQTT and keypress"); // Log to check if this effect is reached
    setMqttStatus('Connecting...'); // Set status to connecting on mount
    setMqttErrorMessage(null); // Clear previous errors

    // Clean up previous client if it exists
    if (mqttClientRef.current) {
        console.log("[MQTT] Disconnecting previous client...");
        mqttClientRef.current.end();
        mqttClientRef.current = null; // Clear the ref
    }

    console.log(`[MQTT] Attempting to connect to ${mqttBroker}:${mqttPort} using MQTT protocol`); // Log before connect

    // Initialize MQTT client in the browser environment, specifying the protocol
    mqttClientRef.current = mqtt.connect({
        host: mqttBroker,
        port: parseInt(mqttPort, 10), // Parse port back to number
        clientId: mqttClientId,
        protocol: 'mqtt' // Explicitly set the protocol to MQTT TCP
        // Add other options like username, password if needed later
    });
    console.log("[MQTT] Client Ref after connect:", mqttClientRef.current); // Log ref value

    // Update MQTT status based on client events
    mqttClientRef.current.on("connect", () => {
      console.log("[MQTT] Client Connected");
      setMqttStatus('Connected');
      setMqttErrorMessage(null); // Clear error message on successful connect
    });

    mqttClientRef.current.on("error", (err) => {
        console.error("[MQTT] Error:", err);
        setMqttStatus('Error');
        setMqttErrorMessage(err.message || 'An unknown MQTT error occurred'); // Capture error message
    });

    mqttClientRef.current.on("close", (hadError) => {
        console.log("[MQTT] Client Disconnected. Had Error:", hadError);
        setMqttStatus('Disconnected');
         if (hadError) {
            // Try to get a more specific reason if available (library dependent)
             setMqttErrorMessage('Disconnected due to error');
         }
    });
    
    // Add offline event listener
    mqttClientRef.current.on("offline", () => {
        console.log("[MQTT] Client Offline");
        setMqttStatus('Disconnected'); // Or a specific 'Offline' status
        setMqttErrorMessage('Client is offline');
    });


    window.addEventListener("keypress", handleKeyPress);

    // Cleanup function to disconnect MQTT client and remove listener
    return () => {
      console.log("[MQTT] Running cleanup for MQTT and keypress");
      window.removeEventListener("keypress", handleKeyPress);
      if (mqttClientRef.current) {
        mqttClientRef.current.end();
        mqttClientRef.current = null; // Clear the ref on cleanup
        console.log("[MQTT] Client Disconnected (cleanup)");
      }
    };
  }, [mqttBroker, mqttPort, mqttTopic, mqttClientId]); // Re-run effect if config changes

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <h1 className="text-2xl font-bold mb-4">CaseVerify Pi</h1>
      <Card className="w-full max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Configuration</h2>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="test-mode">Test Mode</Label>
            <Switch
              id="test-mode"
              checked={testMode}
              onCheckedChange={setTestMode}
            />
          </div>
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
                <Label htmlFor="mqtt-topic">Publish Topic</Label>
                <Input
                  id="mqtt-topic"
                  type="text"
                  value={mqttTopic}
                  onChange={(e) => setMqttTopic(e.target.value)}
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
             </div>
        </CardContent>

        <Separator />

        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Product Sensor GPIO:</Label>
            <p>GPIO 17 (Placeholder) - State: {caseDetected ? 'Case Detected' : 'No Case'}</p>{/* Display Case Detected State */}
          </div>
          <div className="grid gap-2">
            <Label>Reject Output GPIO:</Label>
            <p>GPIO 27 (Placeholder) - State: {rejectOutputState}</p>{/* Display Reject Output State */}
          </div>
        </CardContent>
        <Separator />
        <CardHeader>
          <h2 className="text-lg font-semibold">Verification Results</h2>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Case Detected:</Label>
            <p>{caseDetected ? "Yes, waiting for barcode" : "No"}</p>
          </div>
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
                }`}
            >{result || "Scan a barcode to receive a result"}</p>
          </div>
        </CardContent>
        
      </Card>
    </div>
  );
}
