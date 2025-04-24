"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import mqtt from "mqtt";
import { MqttClient } from "mqtt"; // Import MqttClient type for useRef

// MQTT Configuration
const MQTT_BROKER = "192.168.5.5";
const MQTT_PORT = 1883;
const MQTT_TOPIC = "Tekpak/F6/BarcodeVerifier";
const MQTT_CLIENT_ID = "BarcodeVerifier";

const simulateGPIODetection = (): boolean => {  
    // Simulate case detected by sensor
    return Math.random() > 0.5; 
};

const triggerGPIOOutput = (isFail: boolean): void => {
    // Dummy GPIO output trigger (replace with actual GPIO control)
    console.log(`GPIO Output Triggered: ${isFail ? 'FAIL' : 'No Action'}`);
};

let barcodeBuffer: string = '';

function isValidGTIN(barcode: string): boolean {
  // Basic GTIN format validation (12-14 digits)
  return /^\d{12,14}$/.test(barcode);
}

// publishResult now accepts the client instance
const publishResult = (client: MqttClient | null, result: "PASS" | "FAIL") => {
    if (client && client.connected) {
        console.log(`Result before publishing: ${result}`); // Log the result right before publishing
        client.publish(MQTT_TOPIC, result, (err) => {
            if (err) {
                console.error("MQTT Publish Error:", err);
            }
        });
    } else {
        console.log("Not connected to MQTT broker. Cannot publish.");
    }
};

export default function Home() { 
    console.log("Home function component is being called."); // Log at the start of the function

  const [testMode, setTestMode] = useState(false);
  const [rejectDelay, setRejectDelay] = useState(3000); // milliseconds
  const [barcode, setBarcode] = useState<string | null>(null);
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [caseDetected, setCaseDetected] = useState(false);

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

  // handleScan now calls publishResult with the current client instance
  const handleScan = (scannedBarcode: string) => {
    if (!scannedBarcode) {
      return; // Do not run if the code is empty
    }
    console.log("handleScan called with:", scannedBarcode)
    setBarcode(scannedBarcode);
    const isValid = isValidGTIN(scannedBarcode);
    const currentResult: "PASS" | "FAIL" = isValid ? "PASS" : "FAIL";
    setResult(currentResult);
    publishResult(mqttClientRef.current, currentResult); // Pass client instance
    if (!isValid) {
      triggerGPIOOutput(true);
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
  console.log("Running useEffect for MQTT and keypress"); // Log to check if this effect is reached
  useEffect(() => {
    // Initialize MQTT client in the browser environment
    mqttClientRef.current = mqtt.connect({
        host: MQTT_BROKER,
        port: MQTT_PORT,
        clientId: MQTT_CLIENT_ID,
    });
    console.log("MQTT Client Ref after connect:", mqttClientRef.current); // Log ref value

    mqttClientRef.current.on("connect", () => {
      console.log("MQTT Client Connected");
      console.log("MQTT Broker URL:", MQTT_BROKER);
    });

    mqttClientRef.current.on("error", (err) => {
        console.error("MQTT Error:", err);
        console.log("Trying to connect to:",MQTT_BROKER)
    });

    window.addEventListener("keypress", handleKeyPress);

    // Cleanup function to disconnect MQTT client and remove listener
    return () => {
      window.removeEventListener("keypress", handleKeyPress);
      if (mqttClientRef.current) {
        mqttClientRef.current.end();
        console.log("MQTT Client Disconnected");
      }
    };
  }, []); // Empty dependency array ensures this runs only once on mount

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
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Product Sensor GPIO:</Label>
            <p>GPIO 17 (Placeholder)</p>
          </div>
          <div className="grid gap-2">
            <Label>Reject Output GPIO:</Label>
            <p>GPIO 27 (Placeholder)</p>
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
