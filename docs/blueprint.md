# **App Name**: CaseVerify Pi

## Core Features:

- UI Configuration: User interface for configuring test mode, reject delay, and displaying PASS/FAIL results.
- Barcode Verification Logic: Detect case presence via GPIO sensor input. Scan and validate barcode input from USB scanner against GTIN/case barcode format. Trigger GPIO output on FAIL.
- Configurable Reject Delay: Configurable delay between case detection and FAIL output trigger, settable via UI.

## Style Guidelines:

- Primary color: Dark blue (#1A237E) for a professional look.
- Secondary color: Light gray (#EEEEEE) for backgrounds and neutral elements.
- Accent: Teal (#009688) to highlight important information like PASS/FAIL results and adjustable configuration settings.
- Clear separation of configuration and result display areas.
- Use simple, clear icons for configuration options (test mode toggle, delay setting).

## Original User Request:
create an app to install on a raspberry pi 4.  
the app will need to work as a case barcode verifier. 
it will need to recognize when a case is in front of a sensor connected to a GPIO pin and then look for an input from the usb barcode scanner.  the app should have a user interface that allows the user to toggle a test mode that doesnt require the sensor to run the test continuously.   
if a barcode is read that matches a format typically used for a gtin or case barcode then output "PASS" else "FAIL".   
they code will also need to be able to trigger an output GPIO pin upon FAIL results.   allow for a delay from the time the product detect sensor stops seeing the current package and the timing of the output for the fail reject.   allow the reject delay to be configured in the user interface
  