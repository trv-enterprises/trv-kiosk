#!/usr/bin/env python3
"""
Voice Display - Main Entry Point
Orchestrates wake word detection, STT, intent resolution, and display commands
"""

import asyncio
import logging
import os
import sys
from pathlib import Path
import yaml
import numpy as np
import pyaudio
from typing import Optional

# Local modules
from wake_word import create_detector
from stt import create_stt
from intent import create_resolver
from commander import DisplayCommander
from vad import VoiceActivityDetector

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("voice-display")


class VoiceDisplayPipeline:
    """Main voice processing pipeline."""

    def __init__(self, config_path: str = "config.yaml"):
        """
        Initialize pipeline.

        Args:
            config_path: Path to configuration file
        """
        # Load configuration
        self.config = self._load_config(config_path)

        # Initialize components
        logger.info("Initializing voice display pipeline...")

        self.wake_detector = create_detector(self.config.get("wake_word", {}))
        self.stt = create_stt(self.config.get("whisper", {}))
        self.intent_resolver = create_resolver(
            self.config.get("intent", {}),
            self._get_available_dashboards()
        )
        self.commander = DisplayCommander(self.config.get("display", {}))
        self.vad = VoiceActivityDetector(self.config.get("vad", {}))

        # Audio settings - use 16kHz native for openWakeWord/Whisper
        audio_config = self.config.get("audio", {})
        self.sample_rate = 16000  # Fixed at 16kHz for wake word/STT
        self.channels = 1
        self.chunk_size = 1280  # Standard openWakeWord chunk size (~80ms)
        self.device_name = audio_config.get("device_name", "EMEET")
        self.device_index = audio_config.get("device_index")  # fallback if name lookup fails

        # Recording state
        self.max_recording_duration = self.config.get("whisper", {}).get("max_recording_duration", 6)
        self.recording_buffer = []
        self.is_recording = False

        # Confirmation sound
        self._confirmation_sound = self.config.get("vad", {}).get("confirmation_sound")

        # Running state
        self._running = False
        self._pyaudio = None
        self._audio_stream = None

        logger.info("Pipeline initialized successfully")

    def _load_config(self, config_path: str) -> dict:
        """Load configuration from YAML file."""
        path = Path(config_path)
        if not path.exists():
            logger.warning(f"Config file not found: {config_path}, using defaults")
            return {}

        with open(path) as f:
            return yaml.safe_load(f) or {}

    def _get_available_dashboards(self) -> list:
        """
        Fetch available dashboards from the API.
        Returns empty list if API is not accessible.
        """
        # TODO: Implement API call to get dashboards
        # For now, return sample dashboards
        return ["sensors", "power", "cameras", "weather"]

    def _find_device_by_name(self, pa: pyaudio.PyAudio) -> Optional[int]:
        """Find an input device by name substring (case-insensitive).

        Searches all PyAudio devices for one whose name contains device_name
        and has input channels. Falls back to configured device_index.
        """
        search = self.device_name.lower()
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            if search in info["name"].lower() and info["maxInputChannels"] > 0:
                logger.info(f"Found audio device '{info['name']}' at index {i} "
                            f"(channels={info['maxInputChannels']}, rate={int(info['defaultSampleRate'])})")
                return i

        if self.device_index is not None:
            logger.warning(f"Device '{self.device_name}' not found by name, "
                           f"falling back to configured index {self.device_index}")
            return self.device_index

        logger.warning(f"Device '{self.device_name}' not found, using system default")
        return None

    async def _play_confirmation(self):
        """Play a short confirmation tone on wake word detection."""
        if not self._confirmation_sound or not Path(self._confirmation_sound).exists():
            return
        try:
            display_config = self.config.get("display", {})
            device = display_config.get("alert_audio_device", "default")
            await asyncio.create_subprocess_exec(
                "aplay", "-D", device, self._confirmation_sound,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except Exception as e:
            logger.debug(f"Could not play confirmation sound: {e}")

    def _process_recording(self):
        """Process the recorded audio through STT and intent resolution."""
        if not self.recording_buffer:
            logger.debug("Empty recording buffer")
            return

        # Combine all chunks
        audio = np.concatenate(self.recording_buffer)
        self.recording_buffer = []

        # Transcribe (audio is at 16kHz native)
        logger.info("Transcribing audio...")
        text = self.stt.transcribe(audio, self.sample_rate)

        if not text:
            logger.info("No speech detected")
            return

        # Resolve intent
        logger.info(f"Resolving intent for: '{text}'")
        command = self.intent_resolver.resolve(text)

        # Send to display
        logger.info(f"Sending command: {command}")
        asyncio.create_task(self.commander.send_command(command))

    async def run(self):
        """Run the voice pipeline."""
        logger.info("Starting voice display pipeline...")
        self._running = True

        # Start WebSocket server for display
        await self.commander.start_server()

        # Initialize PyAudio
        self._pyaudio = pyaudio.PyAudio()

        # Resolve input device by name (survives USB re-enumeration across reboots)
        resolved_index = self._find_device_by_name(self._pyaudio)
        logger.info(f"Starting audio stream (device={resolved_index}, sample_rate={self.sample_rate}, chunk_size={self.chunk_size})")

        try:
            # Open audio stream at 16kHz
            self._audio_stream = self._pyaudio.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                input_device_index=resolved_index,
                frames_per_buffer=self.chunk_size
            )

            logger.info("Listening for wake word ('Hey Jarvis')...")
            chunk_count = 0

            while self._running:
                chunk_count += 1

                # Read audio chunk (blocking but fast at 80ms chunks)
                data = self._audio_stream.read(self.chunk_size, exception_on_overflow=False)
                audio_int16 = np.frombuffer(data, dtype=np.int16)

                if self.is_recording:
                    # Accumulate audio for transcription
                    self.recording_buffer.append(audio_int16.copy())

                    # Run VAD on raw PCM bytes
                    decision = self.vad.process_chunk(audio_int16.tobytes(), self.sample_rate)

                    if decision == "stop":
                        logger.info("VAD: speech complete — processing")
                        self.is_recording = False
                        self._process_recording()
                        self.vad.reset()
                        self.wake_detector.reset()
                    elif decision == "discard":
                        logger.info("VAD: no speech — discarding buffer")
                        self.is_recording = False
                        self.recording_buffer = []
                        self.vad.reset()
                        self.wake_detector.reset()
                    else:
                        # Safety net: max recording duration
                        recorded_duration = len(self.recording_buffer) * self.chunk_size / self.sample_rate
                        if recorded_duration >= self.max_recording_duration:
                            logger.info("Max recording duration reached (safety net)")
                            self.is_recording = False
                            self._process_recording()
                            self.vad.reset()
                            self.wake_detector.reset()
                else:
                    # Check for wake word
                    if self.wake_detector.process_audio(audio_int16):
                        logger.info("Wake word detected - listening for command...")
                        self.is_recording = True
                        self.recording_buffer = []
                        self.vad.reset()
                        asyncio.ensure_future(self._play_confirmation())

                # Yield to event loop periodically
                if chunk_count % 10 == 0:
                    await asyncio.sleep(0)

        except Exception as e:
            logger.error(f"Audio stream error: {e}")
            raise
        finally:
            if self._audio_stream:
                self._audio_stream.stop_stream()
                self._audio_stream.close()
            if self._pyaudio:
                self._pyaudio.terminate()
            await self.commander.stop_server()

    def stop(self):
        """Stop the pipeline."""
        logger.info("Stopping voice display pipeline...")
        self._running = False


async def main():
    """Main entry point."""
    # Get config path from args or use default
    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.yaml"

    # Create and run pipeline
    pipeline = VoiceDisplayPipeline(config_path)

    try:
        await pipeline.run()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        pipeline.stop()
    except Exception as e:
        logger.error(f"Pipeline error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
