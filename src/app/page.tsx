"use client";

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// Dummy GPIO pin control functions (replace with actual hardware interaction)
const simulateGPIODetection = (): boolean => {
    // Simulate case detected by sensor
    return Math.random() > 0.5; 
};

const simulateBarcodeScan = (): string | null => {
    // Simulate barcode scanner input
    if (Math.random() > 0.5) {
        // Simulate a valid GTIN-like barcode
        return "00307680017808";
    } else if (Math.random() > 0.3) {
        // Simulate an invalid barcode
        return "12345INVALID";
    }
    return null; // No barcode scanned
};

const triggerGPIOOutput = (isFail: boolean): void => {
    // Dummy GPIO output trigger (replace with actual GPIO control)
    console.log(`GPIO Output Triggered: ${isFail ? 'FAIL' : 'No Action'}`);
};

function isValidGTIN(barcode: string): boolean {
  // Basic GTIN format validation (12-14 digits)
  return /^\d{12,14}$/.test(barcode);
}

export default function Home() {
  const [testMode, setTestMode] = useState(false);
  const [rejectDelay, setRejectDelay] = useState(3000); // milliseconds
  const [barcode, setBarcode] = useState<string | null>(null);
  const [result, setResult] = useState<"PASS" | "FAIL" | null>(null);
  const [caseDetected, setCaseDetected] = useState(false);

    useEffect(() => {
        let barcodeCheckTimeout: NodeJS.Timeout | null = null;

        const handleScan = () => {
            const scannedBarcode = simulateBarcodeScan();
            if (scannedBarcode) {
                setBarcode(scannedBarcode);
                const isValid = isValidGTIN(scannedBarcode);
                setResult(isValid ? "PASS" : "FAIL");

                if (!isValid) {
                    // Trigger GPIO output after delay
                    barcodeCheckTimeout = setTimeout(() => {
                        triggerGPIOOutput(true);
                    }, rejectDelay);
                }
            }
        };

        const caseDetectionInterval = setInterval(() => {
            if (testMode || simulateGPIODetection()) {
                setCaseDetected(true);
                handleScan(); // Simulate barcode scan on case detection
            } else {
                setCaseDetected(false);
                setBarcode(null);
                setResult(null);
                if (barcodeCheckTimeout) {
                    clearTimeout(barcodeCheckTimeout); // Clear timeout if case is no longer detected
                    barcodeCheckTimeout = null;
                }
            }
        }, 2000);

        return () => {
            clearInterval(caseDetectionInterval);
            if (barcodeCheckTimeout) {
                clearTimeout(barcodeCheckTimeout);
            }
        };
    }, [testMode, rejectDelay]);

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
        <Separator/>
        <CardHeader>
          <h2 className="text-lg font-semibold">Verification Results</h2>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Case Detected:</Label>
            <p>{caseDetected ? "Yes" : "No"}</p>
          </div>
          <div className="grid gap-2">
            <Label>Barcode:</Label>
            <p>{barcode || "No barcode scanned"}</p>
          </div>
          <div className="grid gap-2">
            <Label>Result:</Label>
            <p className={`font-bold text-xl ${
                result === "PASS" ? "text-accent" : (result === "FAIL" ? "text-destructive" : "")
              }`}>{result || "Awaiting scan"}</p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button>Start Verification</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
