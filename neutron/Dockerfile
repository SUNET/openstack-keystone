# OpenStack Neutron with oslo-secrets-wrapper and L3 HA fix
# Allows loading sensitive config from Kubernetes Secrets
FROM quay.io/airshipit/neutron:2025.1-ubuntu_noble

USER root

COPY oslo-secrets-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/oslo-secrets-wrapper.sh

# Fix LP#1958149: HA backup router accept_ra not disabled on state change
# https://review.opendev.org/c/openstack/neutron/+/824947
COPY ha.py ha_router.py /var/lib/openstack/lib/python3.12/site-packages/neutron/agent/l3/

USER neutron

ENTRYPOINT ["/usr/local/bin/oslo-secrets-wrapper.sh"]
