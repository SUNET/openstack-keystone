# OpenStack Heat with oslo-secrets-wrapper
# Allows loading sensitive config from Kubernetes Secrets
FROM quay.io/airshipit/heat:2025.2-ubuntu_noble

USER root

COPY oslo-secrets-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/oslo-secrets-wrapper.sh

USER heat

ENTRYPOINT ["/usr/local/bin/oslo-secrets-wrapper.sh"]
