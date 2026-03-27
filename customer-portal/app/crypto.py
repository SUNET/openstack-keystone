"""Symmetric encryption for storing sensitive credentials."""

import base64
import hashlib

from cryptography.fernet import Fernet


_fernet: Fernet | None = None


def init_crypto(secret_key: str) -> None:
    """Initialize the Fernet cipher from the application secret key."""
    global _fernet
    key = base64.urlsafe_b64encode(hashlib.sha256(secret_key.encode()).digest())
    _fernet = Fernet(key)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string and return base64-encoded ciphertext."""
    if _fernet is None:
        raise RuntimeError("Crypto not initialized")
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext string."""
    if _fernet is None:
        raise RuntimeError("Crypto not initialized")
    return _fernet.decrypt(ciphertext.encode()).decode()
