"""
Wake Word Detection using openWakeWord
Listens for "Hey Display" (or similar) to activate voice commands
"""

import numpy as np
from openwakeword import Model
import logging

logger = logging.getLogger(__name__)


class WakeWordDetector:
    """Detects wake word in audio stream."""

    def __init__(self, config: dict):
        """
        Initialize wake word detector.

        Args:
            config: Wake word configuration dict with model, sensitivity, etc.
        """
        self.config = config
        self.model_name = config.get("model", "hey_jarvis")
        self.sensitivity = config.get("sensitivity", 0.5)
        self.sample_rate = config.get("sample_rate", 16000)

        logger.info(f"Loading wake word model: {self.model_name}")

        # Load the openWakeWord model using TFLite (default)
        # Built-in models: hey_jarvis, alexa, hey_mycroft
        self.model = Model(wakeword_models=[self.model_name])

        logger.info(f"Wake word detector initialized (sensitivity: {self.sensitivity})")
        self._log_counter = 0
        self._max_score_seen = 0
        self._max_level_seen = 0.0

    def process_audio(self, audio_chunk: np.ndarray) -> bool:
        """
        Process an audio chunk and check for wake word.

        Args:
            audio_chunk: Audio data as numpy array (int16)

        Returns:
            True if wake word detected, False otherwise
        """
        # Pass int16 audio directly to model - openWakeWord handles conversion internally
        prediction = self.model.predict(audio_chunk)

        # Check if any wake word exceeds threshold
        # prediction is a dict of model_name -> score (float) or list of scores
        for model_name, score in prediction.items():
            # Handle both single float and list of floats
            if isinstance(score, (list, np.ndarray)):
                max_score = max(score) if len(score) > 0 else 0
            else:
                max_score = float(score)

            # Track max score and level seen across the logging window
            if max_score > self._max_score_seen:
                self._max_score_seen = max_score
            chunk_level = np.max(np.abs(audio_chunk)) / 32768.0
            if chunk_level > self._max_level_seen:
                self._max_level_seen = chunk_level

            # Log periodically to show we're processing audio
            self._log_counter += 1
            if self._log_counter % 500 == 0:
                logger.info(f"Audio check #{self._log_counter}: peak_level={self._max_level_seen:.4f}, max_wakeword_score={self._max_score_seen:.3f}")
                self._max_score_seen = 0  # Reset after logging
                self._max_level_seen = 0.0

            if max_score > self.sensitivity:
                logger.info(f"Wake word detected: {model_name} (score: {max_score:.3f})")
                return True

        return False

    def reset(self):
        """Reset detector state for a fresh detection."""
        self.model.reset()


def create_detector(config: dict) -> WakeWordDetector:
    """Factory function to create a wake word detector."""
    return WakeWordDetector(config)
