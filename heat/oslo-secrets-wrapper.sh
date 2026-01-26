#!/bin/bash
# oslo-secrets-wrapper.sh
# Wrapper script that appends secrets from mounted files to oslo.config configuration
# before executing the original service command.
#
# This script is used as the ENTRYPOINT for OpenStack services that need to load
# sensitive configuration (like memcache_secret_key) from Kubernetes Secrets
# rather than having them in ConfigMaps.
#
# Usage: The wrapper is set as ENTRYPOINT, so it receives the original command
#        and arguments. It appends any .conf files from OSLO_SECRETS_DIR to the
#        main config file, then exec's the original command.
#
# Environment variables:
#   OSLO_SECRETS_DIR  - Directory containing secret .conf files (default: /etc/oslo-secrets)
#   OSLO_CONFIG_FILE  - Main config file to append secrets to (auto-detected from service)

set -e

OSLO_SECRETS_DIR="${OSLO_SECRETS_DIR:-/etc/oslo-secrets}"

# Auto-detect the config file based on the service being started
detect_config_file() {
    local cmd="$1"
    case "$cmd" in
        *heat*)      echo "/etc/heat/heat.conf" ;;
        *glance*)    echo "/etc/glance/glance.conf" ;;
        *cinder*)    echo "/etc/cinder/cinder.conf" ;;
        *nova*)      echo "/etc/nova/nova.conf" ;;
        *placement*) echo "/etc/placement/placement.conf" ;;
        *neutron*)   echo "/etc/neutron/neutron.conf" ;;
        *)           echo "" ;;
    esac
}

# Get config file from environment or auto-detect
CONFIG_FILE="${OSLO_CONFIG_FILE:-$(detect_config_file "$1")}"

# Append secrets to config file if secrets directory exists and has files
if [ -d "$OSLO_SECRETS_DIR" ] && [ -n "$CONFIG_FILE" ] && [ -f "$CONFIG_FILE" ]; then
    for secret_file in "$OSLO_SECRETS_DIR"/*.conf; do
        if [ -f "$secret_file" ]; then
            echo "oslo-secrets-wrapper: Appending $(basename "$secret_file") to $CONFIG_FILE"
            echo "" >> "$CONFIG_FILE"
            echo "# Appended from $secret_file by oslo-secrets-wrapper" >> "$CONFIG_FILE"
            cat "$secret_file" >> "$CONFIG_FILE"
        fi
    done
fi

# Execute the original command
exec "$@"
