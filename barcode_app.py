# barcode_app.py - Standalone Python GUI Application

import json
import os
import paho.mqtt.client as mqtt
# Import RPi.GPIO or gpiozero for GPIO access
# import RPi.GPIO as GPIO
# from gpiozero import InputDevice, OutputDevice

# --- Configuration Loading & Saving ---
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), 'settings.json')
settings = {}

def load_settings():
    global settings
    try:
        print(f"[App] Loading settings from {SETTINGS_FILE}")
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
            print("[App] Settings loaded successfully:", settings)
        else:
            print(f"[App] Settings file not found at {SETTINGS_FILE}. Using defaults.")
            settings = {
                "mqttBroker": "192.168.5.5",
                "mqttPort": 1883,
                "mqttVerifyTopic": "Tekpak/F6/BarcodeVerifier",
                "mqttClientId": "PiPythonApp",
                "rejectDelay": 3000,
                "productSensorPin": 17,
                "rejectOutputPin": 27
            }
            save_settings() # Save defaults if file didn't exist

        # Ensure default values exist if loaded settings are incomplete
        settings["mqttBroker"] = settings.get("mqttBroker", "192.168.5.5")
        settings["mqttPort"] = settings.get("mqttPort", 1883)
        settings["mqttVerifyTopic"] = settings.get("mqttVerifyTopic", "Tekpak/F6/BarcodeVerifier")
        settings["mqttClientId"] = settings.get("mqttClientId", "PiPythonApp")
        settings["rejectDelay"] = settings.get("rejectDelay", 3000)
        settings["productSensorPin"] = settings.get("productSensorPin", 17)
        settings["rejectOutputPin"] = settings.get("rejectOutputPin", 27)

    except Exception as e:
        print(f"[App] Error loading settings: {e}")
        # In a GUI app, you might show an error dialog here
        # For now, we'll exit or proceed with potentially incomplete settings
        # exit(1)

def save_settings():
    try:
        print(f"[App] Saving settings to {SETTINGS_FILE}")
        # Remove pin settings if you don't want them in the saved file
        # settings.pop("productSensorPin", None)
        # settings.pop("rejectOutputPin", None)
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"[App] Error saving settings: {e}")
        # In a GUI app, you might show an error dialog here

# --- Global State (GUI Updates) ---
# These variables will hold the current state to update the GUI elements
current_mqtt_status = 'Disconnected'
last_barcode = None
last_result = None
is_case_detected = False
reject_output_state = 'Inactive'

# --- MQTT Client Setup ---
mqtt_client = None
PRODUCT_SENSOR_TOPIC = "Tekpak/F6/ProductSensor/State"
REJECT_OUTPUT_COMMAND_TOPIC = "Tekpak/F6/RejectOutput/Command"
MQTT_VERIFY_TOPIC = "Tekpak/F6/BarcodeVerifier"

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[MQTT] Connected to MQTT Broker: {settings['mqttBroker']}:{settings['mqttPort']}")
        update_gui_mqtt_status('Connected')
        # Subscribe to command topic
        client.subscribe(REJECT_OUTPUT_COMMAND_TOPIC)
        print(f"[MQTT] Subscribed to topic: {REJECT_OUTPUT_COMMAND_TOPIC}")
        # Subscribe to sensor state topic if the GUI needs to show it (optional if GPIO is here)
        # client.subscribe(PRODUCT_SENSOR_TOPIC)
        # print(f"[MQTT] Subscribed to topic: {PRODUCT_SENSOR_TOPIC}")

    else:
        print(f"[MQTT] Failed to connect, return code {rc}")
        update_gui_mqtt_status(f'Error: {rc}')

def on_message(client, userdata, msg):
    print(f"[MQTT] Received message on topic {msg.topic}: {msg.payload.decode()}")
    # Handle incoming commands for reject output
    if msg.topic == REJECT_OUTPUT_COMMAND_TOPIC:
        command = msg.payload.decode().upper()
        if command == 'ACTIVATE':
            activate_reject_output()
        elif command == 'DEACTIVATE':
            deactivate_reject_output()
    # Handle incoming sensor state messages if subscribing in this script
    # elif msg.topic == PRODUCT_SENSOR_TOPIC:
    #     state = msg.payload.decode().lower()
    #     is_case_detected = (state == 'detected' or state == 'high' or state == '1')
    #     update_gui_sensor_state()


def connect_mqtt():
    global mqtt_client
    try:
        print(f"[MQTT] Attempting connection to {settings['mqttBroker']}:{settings['mqttPort']}")
        update_gui_mqtt_status('Connecting...')

        mqtt_client = mqtt.Client(client_id=settings['mqttClientId'])
        mqtt_client.on_connect = on_connect
        mqtt_client.on_message = on_message
        # Add other handlers like on_disconnect, on_subscribe if needed

        # For standard MQTT TCP connection
        mqtt_client.connect(settings['mqttBroker'], settings['mqttPort'], 60) # 60 seconds keepalive

        # Start the MQTT loop in a non-blocking way (for GUI apps)
        mqtt_client.loop_start()

    except Exception as e:
        print(f"[MQTT] Failed to initialize or connect MQTT client: {e}")
        update_gui_mqtt_status(f'Error: {e}')

# --- GPIO Setup & Logic (using RPi.GPIO or gpiozero) ---
# product_sensor_input = None
# reject_output = None

def initialize_gpio():
    # Note: This requires running as root or with appropriate permissions
    # RPi.GPIO example (requires GPIO.setmode(GPIO.BCM))
    # try:
    #     import RPi.GPIO as GPIO
    #     GPIO.setmode(GPIO.BCM)
    #     print(f"[GPIO] Initializing pin {settings['productSensorPin']} as input...")
    #     GPIO.setup(settings['productSensorPin'], GPIO.IN, pull_up_down=GPIO.PUD_UP) # Adjust PUD based on sensor wiring
    #     print(f"[GPIO] GPIO {settings['productSensorPin']} initialized for input.")
    #     # Add event detection or polling here
    #     # GPIO.add_event_detect(settings['productSensorPin'], GPIO.BOTH, callback=sensor_callback, bouncetime=10)

    #     print(f"[GPIO] Initializing pin {settings['rejectOutputPin']} as output...")
    #     GPIO.setup(settings['rejectOutputPin'], GPIO.OUT)
    #     GPIO.output(settings['rejectOutputPin'], GPIO.LOW) # Ensure low initially
    #     print(f"[GPIO] GPIO {settings['rejectOutputPin']} initialized for output.")
    #     update_gui_reject_state()
    # except Exception as e:
    #     print(f"[GPIO] Failed to initialize GPIO: {e}")
    #     # In a GUI app, you might show an error message

    # gpiozero example (requires running with appropriate permissions)
    # try:
    #     from gpiozero import InputDevice, OutputDevice
    #     print(f"[GPIO] Initializing pin {settings['productSensorPin']} as input...")
    #     product_sensor_input = InputDevice(settings['productSensorPin'], pull_up=True) # Adjust pull_up/down
    #     print(f"[GPIO] GPIO {settings['productSensorPin']} initialized for input.")
    #     # Add event handling
    #     # product_sensor_input.when_activated = sensor_activated_callback
    #     # product_sensor_input.when_deactivated = sensor_deactivated_callback

    #     print(f"[GPIO] Initializing pin {settings['rejectOutputPin']} as output...")
    #     reject_output = OutputDevice(settings['rejectOutputPin'], active_high=False, initial_value=False) # Adjust active_high
    #     print(f"[GPIO] GPIO {settings['rejectOutputPin']} initialized for output.")
    #     update_gui_reject_state()
    # except Exception as e:
    #     print(f"[GPIO] Failed to initialize GPIO: {e}")

    print("[GPIO] GPIO initialization placeholder.") # Placeholder if no library is used

def sensor_callback(channel): # Example callback for RPi.GPIO event detection
    # This runs in a separate thread, be careful with GUI updates
    # You might need a queue or thread-safe method to update the GUI
    print(f"[GPIO] Event on channel {channel}")
    # Check current state and publish/update GUI
    # current_state = GPIO.input(channel)
    # state_string = 'detected' if current_state == GPIO.HIGH else 'not detected' # Adjust logic
    # print(f"[GPIO] State: {state_string}")
    # # Publish MQTT
    # if mqtt_client and mqtt_client.connected:
    #     mqtt_client.publish(PRODUCT_SENSOR_TOPIC, state_string)
    # # Update GUI (requires thread-safe method)
    # # update_gui_sensor_state(state_string)

# Example callbacks for gpiozero event handling
# def sensor_activated_callback():
#     print("[GPIO] Sensor activated")
#     # Update state, publish MQTT, update GUI
# def sensor_deactivated_callback():
#     print("[GPIO] Sensor deactivated")
#     # Update state, publish MQTT, update GUI

# Placeholder output control functions
def activate_reject_output():
    # if reject_output:
    #     print("[GPIO] Activating reject output")
    #     # RPi.GPIO: GPIO.output(settings['rejectOutputPin'], GPIO.HIGH) # Or LOW
    #     # gpiozero: reject_output.on()
    #     update_gui_reject_state('Active')
    #     # Deactivate after delay
    #     # import threading
    #     # threading.Timer(settings['rejectDelay'] / 1000, deactivate_reject_output).start()
    # else:
    print("[GPIO] Reject output activated (placeholder)")
    update_gui_reject_state('Active') # Update GUI Placeholder
    # Simulate deactivation after delay
    import threading
    threading.Timer(settings.get('rejectDelay', 3000) / 1000, deactivate_reject_output).start()

def deactivate_reject_output():
    # if reject_output:
    #     print("[GPIO] Deactivating reject output")
    #     # RPi.GPIO: GPIO.output(settings['rejectOutputPin'], GPIO.LOW) # Or HIGH
    #     # gpiozero: reject_output.off()
    #     update_gui_reject_state('Inactive')
    # else:
    print("[GPIO] Reject output deactivated (placeholder)")
    update_gui_reject_state('Inactive') # Update GUI Placeholder

# --- Barcode Scanning (from stdin) ---
import sys
import select
import termios
import tty
import time

def setup_stdin_handling():
    # This is a basic interactive stdin reader. 
    # For a true GUI, you'd likely handle barcode input differently (e.g. dedicated input widget)
    # Or read from the raw device if headless.
    
    # This code makes stdin non-blocking and reads char by char.
    # Be careful if you integrate with a GUI event loop.
    
    # Save original terminal settings
    old_settings = termios.tcgetattr(sys.stdin)

    try:
        tty.setcbreak(sys.stdin.fileno())
        print("Barcode Scanning: Type barcode and press Enter. Press Ctrl+C to exit.")
        barcode_buffer = ''
        
        while True:
            if select.select([sys.stdin], [], [], 0)[0]:
                char = sys.stdin.read(1)

                if char == '\x03': # Ctrl+C
                    cleanup_and_exit(0)
                
                # TODO: Add check if settings or other inputs are focused in the GUI
                # If GUI input is focused, pass the char to the GUI widget

                if char == '' or char == '
': # Enter key
                    if barcode_buffer:
                        handle_scan(barcode_buffer.strip())
                    barcode_buffer = ''
                    # Optionally print newline in log area in GUI
                else:
                    barcode_buffer += char
                    # Optionally echo char in log area or dedicated input area in GUI
                    # print(f"Key: {char}")

            # Add a small sleep to avoid 100% CPU usage in the loop
            time.sleep(0.01)

    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

# --- Core Logic ---

def handle_scan(scanned_barcode):
    global last_barcode, last_result
    if not scanned_barcode:
        return

    # TODO: Re-integrate is_case_detected check based on actual GPIO state
    # if not is_case_detected:
    #     print("[App] Scan ignored: No case detected.")
    #     last_barcode = scanned_barcode + " (Ignored)"
    #     last_result = None
    #     update_gui_display()
    #     return

    print("[App] handle_scan called with:", scanned_barcode)
    last_barcode = scanned_barcode
    is_valid = is_valid_gtin(scanned_barcode)
    last_result = "PASS" if is_valid else "FAIL"
    print(f"[App] Verification Result: {last_result}")

    update_gui_display() # Update GUI with new barcode/result

    # Publish result via MQTT
    if mqtt_client and mqtt_client.connected_flag:
        mqtt_client.publish(settings['mqttVerifyTopic'], last_result)
        print(f"[MQTT] Published verification result: {last_result}")
    else:
        print("[MQTT] Client not connected, cannot publish verify result.")

    # Trigger reject if needed (send command via MQTT)
    if not is_valid:
        print("[App] Scan failed, sending ACTIVATE command for reject output.")
        if mqtt_client and mqtt_client.connected_flag:
             mqtt_client.publish(REJECT_OUTPUT_COMMAND_TOPIC, "ACTIVATE")
             print("[MQTT] Published reject command: ACTIVATE")
        else:
            print("[MQTT] Client not connected, cannot send reject command.")

def is_valid_gtin(barcode):
    # Basic GTIN format validation (12-14 digits)
    return bool(re.fullmatch(r'\d{12,14}', barcode)) # Using regex match

# --- GUI Implementation (Tkinter Placeholder) ---
# import tkinter as tk
# from tkinter import ttk

# root = None
# status_label = None
# barcode_label = None
# result_label = None
# sensor_label = None
# reject_label = None
# settings_window = None

def setup_gui():
    # TODO: Implement Tkinter or other GUI setup here
    # Create main window, frames, labels, buttons, etc.
    # Link GUI elements to state variables (current_mqtt_status, last_barcode, etc.)
    # Create a separate window or section for settings with input fields and a save button

    print("--- GUI Placeholder ---")
    print("TODO: Implement Graphical User Interface here.")
    print("Run main GUI event loop.")

    # Example: Update GUI labels periodically or using state change callbacks
    # root.after(100, update_gui_display) # Example for Tkinter event loop integration
    
    # Keep the main thread alive for GUI event loop
    # root.mainloop()

def update_gui_display():
    # TODO: Update GUI elements based on global state variables
    # if status_label: status_label.config(text=f"MQTT Status: {current_mqtt_status}")
    # if barcode_label: barcode_label.config(text=f"Last Barcode: {last_barcode or 'None'}")
    # if result_label: result_label.config(text=f"Last Result: {last_result or 'N/A'}")
    # if sensor_label: sensor_label.config(text=f"Sensor State: {is_case_detected}")
    # if reject_label: reject_label.config(text=f"Reject State: {reject_output_state}")

    # In a real GUI, you would not print to console for UI updates
    print(f"[GUI Update] Status: {current_mqtt_status}, Barcode: {last_barcode}, Result: {last_result}")

def update_gui_mqtt_status(status):
    global current_mqtt_status
    current_mqtt_status = status
    # TODO: Update MQTT status label in GUI
    update_gui_display()

def update_gui_sensor_state():
    # TODO: Update sensor state label in GUI
    update_gui_display()

def update_gui_reject_state(state):
    global reject_output_state
    reject_output_state = state
    # TODO: Update reject state label in GUI
    update_gui_display()

def update_gui_display_barcode(barcode):
    # TODO: Update barcode label in GUI
    update_gui_display()

def update_gui_display_result(result):
    # TODO: Update result label in GUI
    update_gui_display()

def show_settings_window():
    # TODO: Implement settings window creation and display
    # This window should have input fields for settings and a save button
    print("[GUI] Show settings window placeholder.")
    # Example Tkinter window:
    # global settings_window
    # if settings_window is None or not settings_window.winfo_exists():
    #     settings_window = tk.Toplevel(root)
    #     settings_window.title("Settings")
    #     # Add labels and entry fields for settings
    #     # Add a Save button that calls save_settings and reconnects/reinitializes

# --- Graceful Shutdown ---
import sys
import signal

def cleanup_and_exit(exit_code=0):
    print(f"
[App] Shutting down... (Exit Code: {exit_code})")

    # Stop MQTT loop and disconnect
    if mqtt_client:
        try:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
            print("[MQTT] Client disconnected.")
        except Exception as e:
             print(f"[MQTT] Error during disconnect: {e}")

    # Cleanup GPIO
    # if 'GPIO' in sys.modules and hasattr(GPIO, 'cleanup'):
    #     try:
    #         GPIO.cleanup() # For RPi.GPIO
    #         print("[GPIO] RPi.GPIO cleanup complete.")
    #     except Exception as e:
    #          print(f"[GPIO] Error during RPi.GPIO cleanup: {e}")
    # if 'gpiozero' in sys.modules and product_sensor_input:
    #      try:
    #         product_sensor_input.close()
    #         if reject_output: reject_output.close()
    #         print("[GPIO] gpiozero cleanup complete.")
    #      except Exception as e:
    #          print(f"[GPIO] Error during gpiozero cleanup: {e}")

    # Destroy GUI screen (if using Tkinter)
    # if root:
    #     root.destroy()

    print("[App] Cleanup complete. Exiting.")
    sys.exit(exit_code)

signal.signal(signal.SIGINT, lambda s, f: cleanup_and_exit(0)) # Handle Ctrl+C
signal.signal(signal.SIGTERM, lambda s, f: cleanup_and_exit(0)) # Handle kill/system shutdown

# --- Main Application Flow ---
if __name__ == "__main__":
    load_settings()
    # initialize_gpio() # Call GPIO initialization here when ready
    connect_mqtt()
    # setup_stdin_handling() # Call stdin handling if needed alongside GUI
    setup_gui() # Call GUI setup function

    print("[App] Local application started.")

    # If using a blocking GUI loop (like root.mainloop()), the code will pause here.
    # If using a non-blocking loop (like loop_start for MQTT), the script might exit
    # unless you have something else keeping it alive (like the GUI main loop).

    # For interactive stdin reading alongside a GUI, you might need threads
    # or integrate stdin reading into the GUI event loop.

    # Example of keeping script alive if GUI loop is non-blocking:
    # try:
    #     while True:
    #         time.sleep(1)
    # except KeyboardInterrupt:
    #      cleanup_and_exit(0)

