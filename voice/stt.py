"""
Speech-to-Text using faster-whisper
Transcribes audio to text using CUDA-accelerated Whisper
"""

import numpy as np
from faster_whisper import WhisperModel
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class SpeechToText:
    """Speech-to-text transcription using Whisper."""

    def __init__(self, config: dict):
        """
        Initialize Whisper model.

        Args:
            config: Whisper configuration dict
        """
        self.config = config
        self.model_size = config.get("model", "small")
        self.device = config.get("device", "cuda")
        self.compute_type = config.get("compute_type", "int8")
        self.language = config.get("language", "en")
        self.beam_size = config.get("beam_size", 1)
        self.vad_filter = config.get("vad_filter", True)
        self.initial_prompt = config.get("initial_prompt", None)

        logger.info(f"Loading Whisper model: {self.model_size} on {self.device} ({self.compute_type})")

        # Load the model
        # On Jetson with CUDA, this uses CTranslate2 with CUDA backend
        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type
        )

        logger.info("Whisper model loaded successfully")

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000) -> Optional[str]:
        """
        Transcribe audio to text.

        Args:
            audio: Audio data as numpy array (int16 or float32)
            sample_rate: Sample rate of audio (default 16kHz)

        Returns:
            Transcribed text or None if no speech detected
        """
        # Convert int16 to float32 if needed
        if audio.dtype == np.int16:
            audio_float = audio.astype(np.float32) / 32768.0
        else:
            audio_float = audio

        # Ensure correct shape (1D array)
        if len(audio_float.shape) > 1:
            audio_float = audio_float.flatten()

        try:
            # Transcribe with faster-whisper
            segments, info = self.model.transcribe(
                audio_float,
                language=self.language,
                beam_size=self.beam_size,
                vad_filter=self.vad_filter,
                without_timestamps=True,  # We don't need timestamps for commands
                initial_prompt=self.initial_prompt,
            )

            # Combine all segments into one text
            text_parts = []
            for segment in segments:
                text_parts.append(segment.text.strip())

            text = " ".join(text_parts).strip()

            if text:
                logger.info(f"Transcribed: {text}")
                return text
            else:
                logger.debug("No speech detected in audio")
                return None

        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None


def create_stt(config: dict) -> SpeechToText:
    """Factory function to create STT instance."""
    return SpeechToText(config)
