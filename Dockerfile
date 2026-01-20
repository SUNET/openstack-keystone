# OpenStack Keystone with OIDC support
# Based on airshipit keystone image with libapache2-mod-auth-openidc added
FROM quay.io/airshipit/keystone:2025.1-ubuntu_noble

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends libapache2-mod-auth-openidc && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Enable the module
RUN a2enmod auth_openidc

USER keystone
