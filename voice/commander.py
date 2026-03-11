"""
Display Commander
Sends commands to the React display app via WebSocket
Subscribes to MQTT for Frigate alerts and weather alerts
Also handles local system commands like wake_screen
"""

import asyncio
import json
import logging
import os
import subprocess
import threading
import websockets
from typing import Optional, Callable

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False

logger = logging.getLogger(__name__)


class DisplayCommander:
    """Sends commands to the display app via WebSocket."""

    def __init__(self, config: dict):
        """
        Initialize commander.

        Args:
            config: Display configuration dict with websocket_port, etc.
        """
        self.config = config
        self.host = config.get("websocket_host", "localhost")
        self.port = config.get("websocket_port", 8765)
        self.alert_return_sec = config.get("alert_return_sec", 30)

        # MQTT config for Frigate alerts
        self.mqtt_broker = config.get("mqtt_broker", "YOUR_MQTT_BROKER")
        self.mqtt_port = config.get("mqtt_port", 1883)
        self.mqtt_topic = config.get("mqtt_topic", "frigate/reviews")

        # Audio alert config
        self.alert_audio_file = config.get("alert_audio_file", "/home/user/voice-display/sounds/alert.mp3")
        self.alert_audio_device = config.get("alert_audio_device", "hw:2,0")  # ALSA output device
        self.alert_audio_enabled = config.get("alert_audio_enabled", True)

        # Timer alarm config
        self.timer_alarm_file = config.get("timer_alarm_file", "/home/user/voice-display/sounds/timer_alarm.wav")
        self._alarm_timers = {}  # timer_id -> threading.Timer for repeating alarms
        self._garage_door_state = {}  # door_name -> last known contact state

        self.clients = set()
        self.server = None
        self._server_task = None
        self._mqtt_client = None
        self._mqtt_thread = None
        self._loop = None  # Reference to asyncio loop for MQTT callbacks

    async def start_server(self):
        """Start the WebSocket server for display connections."""
        self._loop = asyncio.get_running_loop()
        self.server = await websockets.serve(
            self._handle_client,
            self.host,
            self.port,
            ping_interval=5,
            ping_timeout=5,
        )
        logger.info(f"WebSocket server started on ws://{self.host}:{self.port}")

        # Start MQTT client for Frigate alerts
        self._start_mqtt()

    async def stop_server(self):
        """Stop the WebSocket server."""
        # Stop all repeating alarms
        self._stop_all_alarms()

        if self._mqtt_client:
            self._mqtt_client.loop_stop()
            self._mqtt_client.disconnect()
            logger.info("MQTT client stopped")

        if self.server:
            self.server.close()
            await self.server.wait_closed()
            logger.info("WebSocket server stopped")

    def _start_mqtt(self):
        """Start MQTT client for Frigate alerts."""
        if not MQTT_AVAILABLE:
            logger.warning("paho-mqtt not installed, Frigate alerts disabled")
            return

        try:
            self._mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            self._mqtt_client.on_connect = self._on_mqtt_connect
            self._mqtt_client.on_message = self._on_mqtt_message

            self._mqtt_client.connect(self.mqtt_broker, self.mqtt_port, 60)
            self._mqtt_client.loop_start()
            logger.info(f"MQTT client connecting to {self.mqtt_broker}:{self.mqtt_port}")
        except Exception as e:
            logger.error(f"Failed to start MQTT client: {e}")

    def _on_mqtt_connect(self, client, userdata, flags, reason_code, properties):
        """Handle MQTT connection."""
        logger.info(f"Connected to MQTT broker, subscribing to {self.mqtt_topic}, weather/alerts, and garage door sensors")
        client.subscribe(self.mqtt_topic)
        client.subscribe("weather/alerts")
        client.subscribe("zigbee2mqtt/Large Garage Door")
        client.subscribe("zigbee2mqtt/Small Garage Door")

    def _on_mqtt_message(self, client, userdata, msg):
        """Handle MQTT messages (Frigate alerts, weather alerts, and garage door sensors)."""
        if msg.topic == "weather/alerts":
            self._handle_weather_alert(msg)
            return
        if msg.topic.startswith("zigbee2mqtt/") and "Garage Door" in msg.topic:
            self._handle_garage_door(msg)
            return
        try:
            payload = json.loads(msg.payload.decode())
            event_type = payload.get("type")

            # Only trigger on new alert-severity reviews (person/car/object)
            # Frigate severity: "alert" = significant object, "detection" = general motion
            severity = payload.get("before", {}).get("severity", "")
            if event_type == "new" and severity == "alert":
                camera = payload.get("before", {}).get("camera", "unknown")
                logger.info(f"Frigate alert received: {camera} (severity={severity})")

                # Play alert sound
                self._play_alert()

                # Send show_frigate with auto-return duration (alert-triggered)
                command = {
                    "action": "show_frigate",
                    "duration": self.alert_return_sec,
                    "source": "alert"
                }
                # Schedule coroutine from MQTT thread
                if self._loop:
                    asyncio.run_coroutine_threadsafe(
                        self.send_command(command),
                        self._loop
                    )
        except json.JSONDecodeError:
            pass
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")

    def _handle_weather_alert(self, msg):
        """Handle weather alert MQTT message — foreground weather view on new alerts."""
        try:
            alerts = json.loads(msg.payload.decode())
            if not alerts or not isinstance(alerts, list) or len(alerts) == 0:
                return

            # Only foreground on new alerts (avoid re-triggering on retained messages)
            alert_ids = frozenset(a.get("id", a.get("event", "")) for a in alerts)
            if hasattr(self, '_last_weather_alert_ids') and alert_ids == self._last_weather_alert_ids:
                return
            self._last_weather_alert_ids = alert_ids

            events = [a.get("event", "unknown") for a in alerts]
            logger.info(f"Weather alerts received: {events}")

            # Play alert sound
            self._play_alert()

            # Show weather view with auto-return
            command = {
                "action": "show_weather",
                "duration": self.alert_return_sec,
                "source": "alert"
            }
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    self.send_command(command),
                    self._loop
                )
        except json.JSONDecodeError:
            pass
        except Exception as e:
            logger.error(f"Error processing weather alert: {e}")

    def _handle_garage_door(self, msg):
        """Handle garage door contact sensor MQTT message — alert when door opens."""
        try:
            payload = json.loads(msg.payload.decode())
            contact = payload.get("contact")
            if contact is None:
                return

            # Extract door name from topic (e.g., "zigbee2mqtt/Large Garage Door" -> "Large Garage Door")
            door_name = msg.topic.replace("zigbee2mqtt/", "")

            # Only alert on state transition (not repeated reports)
            prev_contact = self._garage_door_state.get(door_name)
            self._garage_door_state[door_name] = contact

            if contact is False and prev_contact is not False:
                # Door just opened (transition from closed/unknown to open)
                logger.info(f"Garage door opened: {door_name}")

                # Play alert sound
                self._play_alert()

                # Show Frigate cameras (same as camera motion alert)
                command = {
                    "action": "show_frigate",
                    "duration": self.alert_return_sec,
                    "source": "alert"
                }
                if self._loop:
                    asyncio.run_coroutine_threadsafe(
                        self.send_command(command),
                        self._loop
                    )
            elif contact is True and prev_contact is False:
                logger.info(f"Garage door closed: {door_name}")
        except json.JSONDecodeError:
            pass
        except Exception as e:
            logger.error(f"Error processing garage door message: {e}")

    async def _handle_client(self, websocket):
        """Handle a client connection."""
        self.clients.add(websocket)
        logger.info(f"Display client connected (total: {len(self.clients)})")

        try:
            async for message in websocket:
                logger.debug(f"Received from display: {message}")
                try:
                    data = json.loads(message)
                    action = data.get("action")

                    if action == "timer_expired":
                        timer_id = data.get("timer_id")
                        logger.info(f"Timer {timer_id} expired, starting alarm")
                        self._start_timer_alarm(timer_id)

                    elif action == "timer_alarm_stop":
                        timer_id = data.get("timer_id")
                        logger.info(f"Stopping alarm for timer {timer_id}")
                        if timer_id is not None:
                            self._stop_timer_alarm(timer_id)
                        else:
                            self._stop_all_alarms()

                    elif action == "timer_error":
                        logger.info("Timer error, playing error sound")
                        self._play_error_sound()

                except json.JSONDecodeError:
                    logger.debug(f"Non-JSON message from display: {message}")
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            logger.info(f"Display client disconnected (total: {len(self.clients)})")

    async def send_command(self, command: dict):
        """
        Send a command to all connected displays.
        Handles local system commands (like wake_screen) directly.

        Args:
            command: Command dict with action and parameters
        """
        action = command.get("action")

        # Handle local system commands
        if action == "wake_screen":
            self._wake_screen()
            return

        # For display commands, send via WebSocket
        if not self.clients:
            logger.warning("No display clients connected")
            return

        # Note: duration is only added by alert-triggered commands (MQTT)
        # Voice commands do NOT auto-return - user must say "show clock"

        # Format as expected by display
        message = json.dumps(command)

        # Send to all connected clients
        disconnected = set()
        for client in self.clients:
            try:
                await client.send(message)
                logger.info(f"Sent to display client: {message}")
            except (websockets.ConnectionClosed, websockets.ConnectionClosedError,
                    websockets.ConnectionClosedOK):
                logger.warning("Client disconnected during send, removing")
                disconnected.add(client)
            except Exception as e:
                logger.warning(f"Failed to send to client: {e}, removing")
                disconnected.add(client)

        # Clean up disconnected clients
        self.clients -= disconnected
        if disconnected:
            logger.info(f"Cleaned up {len(disconnected)} dead client(s), {len(self.clients)} remaining")

    def _start_timer_alarm(self, timer_id):
        """Start repeating alarm for an expired timer."""
        # Play immediately
        self._play_timer_alarm_sound()

        # Schedule repeat every 15 seconds
        def repeat():
            self._play_timer_alarm_sound()
            # Reschedule if still active
            if timer_id in self._alarm_timers:
                t = threading.Timer(15.0, repeat)
                t.daemon = True
                self._alarm_timers[timer_id] = t
                t.start()

        t = threading.Timer(15.0, repeat)
        t.daemon = True
        self._alarm_timers[timer_id] = t
        t.start()
        logger.info(f"Repeating alarm started for timer {timer_id}")

    def _stop_timer_alarm(self, timer_id):
        """Stop the repeating alarm for a specific timer."""
        t = self._alarm_timers.pop(timer_id, None)
        if t:
            t.cancel()
            logger.info(f"Alarm stopped for timer {timer_id}")

    def _stop_all_alarms(self):
        """Stop all repeating alarms."""
        for timer_id, t in list(self._alarm_timers.items()):
            t.cancel()
        self._alarm_timers.clear()
        logger.info("All alarms stopped")

    def _play_timer_alarm_sound(self):
        """Play the timer alarm sound file."""
        if not os.path.exists(self.timer_alarm_file):
            logger.warning(f"Timer alarm file not found: {self.timer_alarm_file}")
            return

        try:
            subprocess.Popen(
                [
                    "mpv", "--no-terminal", "--no-video",
                    f"--audio-device=alsa/{self.alert_audio_device}",
                    self.timer_alarm_file
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            logger.info("Timer alarm sound played")
        except FileNotFoundError:
            logger.error("mpv not installed - cannot play timer alarm")
        except Exception as e:
            logger.error(f"Failed to play timer alarm: {e}")

    def _play_error_sound(self):
        """Play a short error sound."""
        # Reuse the confirmation sound as a stand-in for error feedback
        # A dedicated error sound could be added later
        confirm_sound = self.config.get("confirmation_sound")
        if confirm_sound and os.path.exists(confirm_sound):
            try:
                subprocess.Popen(
                    [
                        "aplay", "-D", self.alert_audio_device,
                        confirm_sound
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            except Exception as e:
                logger.error(f"Failed to play error sound: {e}")

    def _play_alert(self):
        """Play alert sound for Frigate notifications."""
        if not self.alert_audio_enabled:
            return

        if not os.path.exists(self.alert_audio_file):
            logger.warning(f"Alert sound file not found: {self.alert_audio_file}")
            return

        try:
            # Use mpv for MP3 playback (aplay only handles raw PCM/WAV)
            subprocess.Popen(
                [
                    "mpv", "--no-terminal", "--no-video",
                    f"--audio-device=alsa/{self.alert_audio_device}",
                    self.alert_audio_file
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            logger.info("Alert sound played")
        except FileNotFoundError:
            logger.error("mpv not installed - cannot play alert sound")
        except Exception as e:
            logger.error(f"Failed to play alert sound: {e}")

    def _wake_screen(self):
        """Wake the display by simulating mouse movement."""
        try:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            # Move mouse slightly and back
            subprocess.run(
                ["xdotool", "mousemove_relative", "1", "1"],
                env=env,
                check=True,
                capture_output=True
            )
            subprocess.run(
                ["xdotool", "mousemove_relative", "--", "-1", "-1"],
                env=env,
                check=True,
                capture_output=True
            )
            logger.info("Screen wake command sent")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to wake screen: {e}")
        except FileNotFoundError:
            logger.error("xdotool not installed - cannot wake screen")

    def execute_command(self, command: dict):
        """
        Synchronous wrapper to send a command.
        Creates new event loop if needed.

        Args:
            command: Command dict with action and parameters
        """
        try:
            loop = asyncio.get_running_loop()
            asyncio.create_task(self.send_command(command))
        except RuntimeError:
            # No running loop, create one
            asyncio.run(self.send_command(command))


class CommanderServer:
    """
    Standalone WebSocket server that can be run in a separate process.
    Used when the main voice loop needs a persistent server.
    """

    def __init__(self, config: dict, on_command: Optional[Callable] = None):
        """
        Initialize server.

        Args:
            config: Display configuration
            on_command: Optional callback when command is received
        """
        self.commander = DisplayCommander(config)
        self.on_command = on_command
        self._running = False

    async def run(self):
        """Run the WebSocket server."""
        self._running = True
        await self.commander.start_server()

        # Keep running until stopped
        while self._running:
            await asyncio.sleep(0.1)

        await self.commander.stop_server()

    def stop(self):
        """Stop the server."""
        self._running = False

    async def dispatch(self, command: dict):
        """Dispatch a command to connected displays."""
        await self.commander.send_command(command)

        if self.on_command:
            self.on_command(command)


def create_commander(config: dict) -> DisplayCommander:
    """Factory function to create commander."""
    return DisplayCommander(config)
