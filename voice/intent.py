"""
Intent Resolution using local pattern matching
Parses transcribed text into actionable commands without external API calls
"""

import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# Sound-alike substitutions for common Whisper mishearings
# Maps misheard words to their intended words
SOUND_ALIKES = {
    # "show" mishearings
    "sure": "show",
    "so": "show",
    "shall": "show",
    "should": "show",
    "shoe": "show",
    "cho": "show",
    "sho": "show",
    "chow": "show",
    "shaw": "show",
    # "clock" mishearings
    "cloak": "clock",
    "clog": "clock",
    "cluck": "clock",
    "block": "clock",
    "loc": "clock",
    # "camera" mishearings
    "camra": "camera",
    "camaras": "cameras",
    "cameron": "camera",
    "cams": "cameras",
    "cambers": "cameras",
    "cam": "camera",
    # "frigate" mishearings
    "frigit": "frigate",
    "frigat": "frigate",
    "frig it": "frigate",
    # "dashboard" mishearings
    "dash board": "dashboard",
    "dashwood": "dashboard",
    # "display" mishearings
    "this play": "display",
    "displace": "display",
    # "timer" mishearings
    "timmer": "timer",
    "tamer": "timer",
    "dimer": "timer",
    # "alarm" mishearings
    "a lot": "alarm",
    "a long": "alarm",
    "along": "alarm",
    # "cancel" mishearings (including past tense from Whisper)
    "cancelled": "cancel",
    "canceled": "cancel",
    "council": "cancel",
    "consul": "cancel",
    # "minute" mishearings
    "minit": "minute",
    "mint": "minute",
    # "pause" mishearings
    "paws": "pause",
    "paus": "pause",
    "pos": "pause",
    # "resume" mishearings
    "presume": "resume",
    "result": "resume",
    # "continue" mishearings
    "can to new": "continue",
}

# Number words to digits
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "twenty five": 25, "thirty": 30, "forty five": 45, "sixty": 60, "ninety": 90,
}


# Define patterns for each intent
# Each pattern list contains regex patterns that match the intent
# Order matters: set_timer must come before reset_timer (both contain "set"/"reset")
INTENT_PATTERNS = {
    "set_timer": [
        r"\b(set|start|create|add)\b.*\b(timer|alarm)\b",
        r"\b(timer|alarm)\b.*\b(for|to)\b.*\b(second|minute|hour)",
        r"\b(timer|alarm)\b.*\b\d+\s*(second|minute|hour)",
        r"\b\d+\s*(second|minute|hour).*\b(timer|alarm)\b",
        r"\b(a\s+)?\d+\s*(second|minute|hour)\s+(timer|alarm)\b",
        # Catch Whisper mistranscriptions like "set of 10 minutes time"
        r"\bset\b.*\b\d+\s*(seconds?|minutes?|mins?|hours?)\b",
    ],
    "reset_timer": [
        r"\b(reset|restart)\b.*\b(timer|alarm)\b",
        r"\b(timer|alarm)\b.*\b(reset|restart)\b",
    ],
    "cancel_timer": [
        r"\b(cancell?e?d?|stopp?e?d?|clear(?:ed)?|remov(?:ed?|e)|delet(?:ed?|e)|dismiss(?:ed)?)\b.*\b(timers?|alarms?|time)\b",
        r"\b(timers?|alarms?)\b.*\b(cancel|stop|clear|off)\b",
        # Catch "cancel" + number (almost certainly a timer cancel)
        r"\b(cancell?e?d?|stopp?e?d?)\b.*\bnumber\s*([1-3]|one|two|three)\b",
        r"\b(cancell?e?d?|stopp?e?d?)\b.*\b([1-3]|one|two|three)\b",
    ],
    "show_timer": [
        r"\b(show|display|go\s*to|switch\s*to)\b.*\b(timer|alarm)",
        r"\b(timer|alarm)\b.*\b(show|display|view)\b",
        r"\b(the\s+)?(timers?|alarms?)\b$",
    ],
    "show_clock": [
        r"\b(show|display|go\s*to|switch\s*to|open)\b.*\b(clock|time)\b",
        r"\b(clock|time)\b.*\b(show|display|view)\b",
        r"\bwhat\s*time\b",
        r"\b(the\s+)?clock\b$",
        r"\b(the\s+)?time\b$",
    ],
    "show_frigate": [
        r"\b(show|display|go\s*to|switch\s*to|open)\b.*\b(camera|cameras|video|frigate|feed|feeds)\b",
        r"\b(camera|cameras|video|frigate|feed|feeds)\b.*\b(show|display|view)\b",
        r"\b(the\s+)?(camera|cameras|video)\b$",
    ],
    "show_dashboard": [
        r"\b(show|display|go\s*to|switch\s*to|open)\b.*\b(dashboard|dash|stats|sensors)\b",
        r"\b(dashboard|dash|stats|sensors)\b.*\b(show|display|view)\b",
        r"\b(the\s+)?(dashboard|dash)\b$",
    ],
    "show_weather": [
        r"\b(show|display|go\s*to|switch\s*to|open)\b.*\b(weather|forecast|temperature|temp)\b",
        r"\b(weather|forecast|temperature)\b.*\b(show|display|view)\b",
        r"\b(the\s+)?(weather|forecast)\b$",
        r"\bwhat.*\b(weather|temperature|forecast)\b",
    ],
    # Frigate alert commands — only published to MQTT when the display
    # is on the dashboard view. Gating happens in the commander, which
    # knows the current view. When NOT on dashboard, commander falls
    # back to view navigation (show → show_alerts view, next/prev/etc.
    # are dropped). Ordered before show_alerts so "next alert" etc.
    # match the specific intent first.
    "frigate_alert_next": [
        r"\bnext\s+(alert|camera|one|event)\b",
        r"\b(go\s*to\s*the\s*)?next\b$",
    ],
    "frigate_alert_previous": [
        r"\b(previous|prev|back|last)\s+(alert|camera|one|event)\b",
        r"\bprevious\b$",
    ],
    "frigate_alert_reviewed": [
        r"\b(mark(\s+as)?|mark\s+it)\s+review(ed)?\b",
        r"\b(that'?s?\s+)?review(ed)?\b$",
        r"\bgot\s+it\b$",
        r"\backnowledge(d)?\b",
    ],
    "frigate_alert_dismiss": [
        r"\bdismiss(\s+(the\s+)?alert)?\b",
    ],
    "frigate_alert_close": [
        r"\bclose\s+(the\s+)?(alert|modal|popup|it)\b",
        r"\bclose\b$",
    ],
    "frigate_alert_show": [
        r"\b(show|open|view)\s+(the\s+)?(first\s+)?alert\b(?!s)",
        r"\bopen\s+alert\b",
    ],
    "show_alerts": [
        r"\b(show|display|go\s*to|switch\s*to|open|view)\b.*\b(alerts|notification|notifications)\b",
        r"\b(alerts|notification|notifications)\b.*\b(show|display|view)\b",
        r"\b(the\s+)?(alerts|notifications?)\b$",
    ],
    "wake_screen": [
        r"\b(wake|turn\s*on|activate)\b.*\b(screen|display|monitor)\b",
        r"\b(screen|display|monitor)\b.*\b(wake|on)\b",
    ],
}


class IntentResolver:
    """Resolves spoken text into display commands using local pattern matching."""

    def __init__(self, config: dict = None, available_dashboards: list = None):
        """
        Initialize intent resolver.

        Args:
            config: Configuration dict (for compatibility, not used)
            available_dashboards: List of available dashboard names/IDs
        """
        self.config = config or {}
        self.available_dashboards = available_dashboards or []

        # Compile regex patterns for performance
        self.compiled_patterns = {}
        for intent, patterns in INTENT_PATTERNS.items():
            self.compiled_patterns[intent] = [
                re.compile(pattern, re.IGNORECASE) for pattern in patterns
            ]

        logger.info("Intent resolver initialized with local pattern matching")

    def update_dashboards(self, dashboards: list):
        """Update the list of available dashboards."""
        self.available_dashboards = dashboards

    def resolve(self, text: str) -> dict:
        """
        Resolve spoken text into a command using pattern matching.

        Args:
            text: Transcribed spoken text

        Returns:
            Command dict with action and parameters
        """
        if not text:
            return {"action": "unknown", "message": "No speech detected"}

        # Normalize text
        text_clean = text.strip().lower()

        # Remove common filler words/phrases
        text_clean = re.sub(r"\b(please|can you|could you|would you|i want to|i'd like to)\b", "", text_clean)
        # Strip trailing punctuation (Whisper often adds periods/question marks)
        text_clean = re.sub(r"[.?!,]+$", "", text_clean)
        text_clean = re.sub(r"\s+", " ", text_clean).strip()

        # Apply sound-alike substitutions for common mishearings
        text_substituted = text_clean
        for misheard, intended in SOUND_ALIKES.items():
            text_substituted = re.sub(r"\b" + re.escape(misheard) + r"\b", intended, text_substituted)

        if text_substituted != text_clean:
            logger.info(f"Sound-alike substitution: '{text_clean}' -> '{text_substituted}'")
            text_clean = text_substituted

        logger.info(f"Transcribed: '{text}' -> cleaned: '{text_clean}'")

        # Try to match each intent
        for intent, patterns in self.compiled_patterns.items():
            for pattern in patterns:
                if pattern.search(text_clean):
                    logger.info(f"Matched intent '{intent}' for: '{text}'")
                    return self._build_command(intent, text_clean)

        # No match found
        logger.info(f"No intent matched for: '{text}'")
        return {"action": "unknown", "message": f"Did not understand: {text}"}

    def _build_command(self, intent: str, text: str) -> dict:
        """Build command dict for matched intent."""
        if intent == "show_clock":
            return {"action": "show_clock"}

        elif intent == "show_frigate":
            return {"action": "show_frigate"}

        elif intent == "show_dashboard":
            # Try to extract specific dashboard name
            dashboard_name = self._extract_dashboard_name(text)
            return {"action": "show_dashboard", "dashboard_name": dashboard_name}

        elif intent == "wake_screen":
            return {"action": "wake_screen"}

        elif intent == "set_timer":
            duration = self._extract_timer_duration(text)
            if duration is None:
                return {"action": "unknown", "message": "Could not parse timer duration"}
            slot = self._extract_slot_number(text, strict=True)
            label = self._format_timer_label(duration)
            return {"action": "set_timer", "duration": duration, "label": label, "slot": slot}

        elif intent == "reset_timer":
            slot = self._extract_slot_number(text)
            return {"action": "reset_timer", "slot": slot}

        elif intent == "cancel_timer":
            # Check for "all" keyword
            which = "all" if re.search(r"\ball\b", text) else "one"
            slot = self._extract_slot_number(text)
            return {"action": "cancel_timer", "slot": slot, "which": which}

        elif intent == "show_weather":
            return {"action": "show_weather"}

        elif intent == "show_alerts":
            return {"action": "show_alerts"}

        elif intent == "show_timer":
            return {"action": "show_timer"}

        elif intent.startswith("frigate_alert_"):
            # The suffix maps directly to the dashboard MQTT action.
            sub_action = intent[len("frigate_alert_"):]
            return {"action": "frigate_alert", "sub_action": sub_action}

        else:
            return {"action": intent}

    def _extract_dashboard_name(self, text: str) -> str:
        """Extract dashboard name from text if mentioned."""
        # Check if any known dashboard is mentioned
        for dashboard in self.available_dashboards:
            if dashboard.lower() in text:
                return dashboard
        return "default"

    def _extract_timer_duration(self, text: str) -> Optional[int]:
        """
        Extract timer duration in seconds from text.

        Handles:
        - "5 minutes" -> 300
        - "one hour" -> 3600
        - "30 seconds" -> 30
        - "1 and a half minutes" -> 90
        - "a half hour" -> 1800
        - "90 seconds" -> 90
        """
        # Replace number words with digits first
        normalized = text
        # Handle multi-word numbers first (e.g., "twenty five")
        for word, num in sorted(NUMBER_WORDS.items(), key=lambda x: -len(x[0])):
            normalized = re.sub(r"\b" + re.escape(word) + r"\b", str(num), normalized)

        # Try "X and a half minutes" pattern
        m = re.search(r"(\d+)\s+and\s+a\s+half\s+(hour|minute|second)", normalized)
        if m:
            num = int(m.group(1))
            unit = m.group(2)
            if "hour" in unit:
                return num * 3600 + 1800
            elif "minute" in unit:
                return num * 60 + 30
            else:
                return num + 1  # half a second, unlikely but handle it

        # Try "half (an) hour/minute"
        m = re.search(r"\bhalf\s+(an?\s+)?(hour|minute)", normalized)
        if m:
            if "hour" in m.group(2):
                return 1800
            else:
                return 30

        # Try "N hours and N minutes" or "N hours N minutes"
        m = re.search(r"(\d+)\s*hours?\s+(?:and\s+)?(\d+)\s*minutes?", normalized)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60

        # Try "N unit" pattern
        m = re.search(r"(\d+)\s*(hours?|minutes?|mins?|seconds?|secs?)", normalized)
        if m:
            num = int(m.group(1))
            unit = m.group(2).lower()
            if unit.startswith("hour"):
                return num * 3600
            elif unit.startswith("min"):
                return num * 60
            elif unit.startswith("sec"):
                return num

        # Try bare number (assume minutes)
        m = re.search(r"\b(\d+)\b", normalized)
        if m:
            return int(m.group(1)) * 60

        return None

    def _extract_slot_number(self, text: str, strict: bool = False) -> Optional[int]:
        """
        Extract timer slot number (1-3) from text.

        Args:
            strict: If True, only match explicit slot references like "timer 2".
                    If False, also match bare numbers (for cancel/reset).
        """
        # Replace number words
        normalized = text
        for word, num in NUMBER_WORDS.items():
            if num <= 3:
                normalized = re.sub(r"\b" + re.escape(word) + r"\b", str(num), normalized)

        # Look for "timer N" or "alarm N" or "timer number N"
        m = re.search(r"\b(timer|alarm)\s*(?:number\s*)?([1-3])\b", normalized)
        if m:
            return int(m.group(2))

        # Look for "N timer/alarm" (e.g., "first timer" already handled by number words -> "1 timer")
        m = re.search(r"\b([1-3])\s*(?:st|nd|rd|th)?\s*(timer|alarm)\b", normalized)
        if m:
            return int(m.group(1))

        if strict:
            return None

        # Broader fallbacks for cancel/reset only:

        # "number N"
        m = re.search(r"\bnumber\s*([1-3])\b", normalized)
        if m:
            return int(m.group(1))

        # Bare number 1-3 (for "cancel 1", "stop 2")
        m = re.search(r"\b([1-3])\b", normalized)
        if m:
            return int(m.group(1))

        return None

    def _format_timer_label(self, seconds: int) -> str:
        """Format duration in seconds into a human-readable label."""
        if seconds >= 3600:
            hours = seconds // 3600
            mins = (seconds % 3600) // 60
            if mins > 0:
                return f"{hours}h {mins}m"
            return f"{hours} hour{'s' if hours != 1 else ''}"
        elif seconds >= 60:
            mins = seconds // 60
            secs = seconds % 60
            if secs > 0:
                return f"{mins}m {secs}s"
            return f"{mins} minute{'s' if mins != 1 else ''}"
        else:
            return f"{seconds} second{'s' if seconds != 1 else ''}"


def create_resolver(config: dict = None, dashboards: list = None) -> IntentResolver:
    """Factory function to create intent resolver."""
    return IntentResolver(config, dashboards)
