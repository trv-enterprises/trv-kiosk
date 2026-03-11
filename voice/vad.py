"""
Voice Activity Detection using WebRTC VAD

Three-phase state machine that detects when a user starts and stops speaking,
enabling early termination of recording after wake word detection.

Phases:
  PRE_SPEECH  — Waiting for user to begin talking (max pre_speech_timeout_ms)
  SPEECH      — User is actively speaking
  POST_SPEECH — Silence after speech detected; sustained silence triggers stop
"""

import logging
from collections import deque
from enum import Enum, auto
from typing import Union

import webrtcvad

logger = logging.getLogger(__name__)

# WebRTC VAD requires specific frame durations
FRAME_DURATION_MS = 20
SAMPLES_PER_FRAME = 320  # 20ms at 16kHz


class Phase(Enum):
    PRE_SPEECH = auto()
    SPEECH = auto()
    POST_SPEECH = auto()


class VoiceActivityDetector:
    """
    WebRTC VAD wrapper with sliding-window smoothing.

    Accepts 80ms audio chunks (1280 samples at 16kHz) — the same chunk size
    used by openWakeWord — and returns a per-chunk decision:
      "continue" — keep recording
      "stop"     — speech finished, process the recording
      "discard"  — no speech detected within timeout, discard buffer
    """

    def __init__(self, config: dict):
        self.aggressiveness = config.get("aggressiveness", 2)
        self.silence_threshold_ms = config.get("silence_threshold_ms", 800)
        self.pre_speech_timeout_ms = config.get("pre_speech_timeout_ms", 3000)
        self.min_speech_ms = config.get("min_speech_ms", 200)

        # Sliding window sizes (in frames)
        self._speech_window_size = 5
        self._speech_window_threshold = 3  # 3/5 frames must be speech
        self._silence_window_size = 8
        self._silence_window_threshold = 6  # 6/8 frames must be silence

        self._vad = webrtcvad.Vad(self.aggressiveness)
        self.reset()

        logger.info(
            f"VAD initialized: aggressiveness={self.aggressiveness}, "
            f"silence={self.silence_threshold_ms}ms, "
            f"pre_speech_timeout={self.pre_speech_timeout_ms}ms"
        )

    def reset(self):
        """Reset state for a new recording session."""
        self._phase = Phase.PRE_SPEECH
        self._elapsed_ms = 0
        self._speech_ms = 0
        self._silence_ms = 0
        self._speech_window = deque(maxlen=self._speech_window_size)
        self._silence_window = deque(maxlen=self._silence_window_size)

    def process_chunk(self, audio_int16: Union[bytes, memoryview], sample_rate: int = 16000) -> str:
        """
        Process an 80ms audio chunk and return a decision.

        Args:
            audio_int16: Raw PCM16 audio bytes (1280 samples = 2560 bytes at 16kHz)
            sample_rate: Audio sample rate (must be 16000)

        Returns:
            "continue", "stop", or "discard"
        """
        if isinstance(audio_int16, memoryview):
            audio_int16 = bytes(audio_int16)

        chunk_ms = (len(audio_int16) // 2) * 1000 // sample_rate
        self._elapsed_ms += chunk_ms

        # Split chunk into 20ms frames and classify each
        frame_bytes = SAMPLES_PER_FRAME * 2  # 2 bytes per int16 sample
        num_frames = len(audio_int16) // frame_bytes

        frame_results = []
        for i in range(num_frames):
            frame = audio_int16[i * frame_bytes : (i + 1) * frame_bytes]
            is_speech = self._vad.is_speech(frame, sample_rate)
            frame_results.append(is_speech)

        # Update sliding windows with each frame result
        for is_speech in frame_results:
            self._speech_window.append(is_speech)
            self._silence_window.append(not is_speech)

        # Smoothed decisions from sliding windows
        speech_detected = (
            len(self._speech_window) >= self._speech_window_threshold
            and sum(self._speech_window) >= self._speech_window_threshold
        )
        silence_detected = (
            len(self._silence_window) >= self._silence_window_threshold
            and sum(self._silence_window) >= self._silence_window_threshold
        )

        # --- State machine ---
        if self._phase == Phase.PRE_SPEECH:
            if speech_detected:
                logger.debug(f"Speech started at {self._elapsed_ms}ms")
                self._phase = Phase.SPEECH
                self._speech_ms = 0
                self._silence_ms = 0
            elif self._elapsed_ms >= self.pre_speech_timeout_ms:
                logger.info(
                    f"No speech detected within {self.pre_speech_timeout_ms}ms — discarding"
                )
                return "discard"

        elif self._phase == Phase.SPEECH:
            self._speech_ms += chunk_ms
            if silence_detected:
                logger.debug(
                    f"Post-speech silence at {self._elapsed_ms}ms "
                    f"(speech lasted {self._speech_ms}ms)"
                )
                self._phase = Phase.POST_SPEECH
                self._silence_ms = chunk_ms

        elif self._phase == Phase.POST_SPEECH:
            if speech_detected:
                # Speaker resumed — go back to SPEECH
                logger.debug("Speech resumed during post-speech silence")
                self._phase = Phase.SPEECH
                self._silence_ms = 0
            else:
                self._silence_ms += chunk_ms
                if self._silence_ms >= self.silence_threshold_ms:
                    if self._speech_ms >= self.min_speech_ms:
                        logger.info(
                            f"Speech complete: {self._speech_ms}ms speech, "
                            f"{self._silence_ms}ms trailing silence"
                        )
                        return "stop"
                    else:
                        logger.info(
                            f"Speech too short ({self._speech_ms}ms < "
                            f"{self.min_speech_ms}ms) — discarding"
                        )
                        return "discard"

        return "continue"
