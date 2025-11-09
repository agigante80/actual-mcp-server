# Deployment Guide

This guide covers various deployment scenarios for the Actual MCP Server.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Docker Deployment](#docker-deployment)
- [Docker Compose](#docker-compose)
- [Kubernetes](#kubernetes)
- [Bare Metal / VM](#bare-metal--vm)
- [Production Considerations](#production-considerations)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before deploying, ensure you have:

1. **An Actual Budget server** running and accessible
2. **Actual Budget credentials**: password and sync ID
3. **Docker** (for containerized deployments) or **Node.js 20+** (for bare metal)
4. **Network access** between the MCP server and Actual Budget server
5. **SSL/TLS certificates** (recommended for production)

## Docker Deployment

### Quick Start

```bash
# Pull the latest image
docker pull ghcr.io/agigante80/actual-mcp-server:latest

# Run with environment variables
docker run -d \
  --name actual-mcp-server \
  -p 3000:3000 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD=your_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -v $(pwd)/actual-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

### Using Docker Secrets (Recommended)

```bash
# Create a secret file
mkdir -p secrets
echo "your_actual_password" > secrets/actual_password.txt
chmod 600 secrets/actual_password.txt

# Run with secret
docker run -d \
  --name actual-mcp-server \
  -p 3000:3000 \
  -e ACTUAL_SERVER_URL=http://your-actual-server:5006 \
  -e ACTUAL_PASSWORD_FILE=/run/secrets/actual_password \
  -e ACTUAL_BUDGET_SYNC_ID=your_sync_id \
  -v $(pwd)/secrets/actual_password.txt:/run/secrets/actual_password:ro \
  -v actual-mcp-data:/data \
  ghcr.io/agigante80/actual-mcp-server:latest
```

### Building Custom Image

```bash
# Clone the repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Build the image
docker build -t actual-mcp-server:custom .

# Run your custom image
docker run -d \
  --name actual-mcp-server \
  -p 3000:3000 \
  --env-file .env \
  -v actual-mcp-data:/data \
  actual-mcp-server:custom
```

## Docker Compose

### Development Setup

```bash
# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Start with development profile
docker compose --profile dev up
```

### Full Stack (Actual + MCP Server)

```bash
# Start both Actual Budget and MCP Server
docker compose --profile fullstack --profile dev up -d

# Access Actual Budget: http://localhost:5006
# Access MCP Server: http://localhost:3000
```

### Production Setup

```bash
# Create secrets directory
mkdir -p secrets
echo "your_actual_password" > secrets/actual_password.txt
chmod 600 secrets/actual_password.txt

# Configure environment
cp .env.example .env
# Edit .env for production settings

# Start production services
docker compose --profile production up -d
```

### Docker Compose with Traefik (HTTPS)

```yaml
# Add to docker-compose.yaml
services:
  mcp-server-prod:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mcp.rule=Host(`mcp.yourdomain.com`)"
      - "traefik.http.routers.mcp.entrypoints=websecure"
      - "traefik.http.routers.mcp.tls.certresolver=letsencrypt"
      - "traefik.http.services.mcp.loadbalancer.server.port=3000"
```

## Kubernetes

### Basic Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: actual-mcp-server
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: actual-mcp-server
  template:
    metadata:
      labels:
        app: actual-mcp-server
    spec:
      containers:
      - name: mcp-server
        image: ghcr.io/agigante80/actual-mcp-server:latest
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: ACTUAL_SERVER_URL
          value: "http://actual-server.actual.svc.cluster.local:5006"
        - name: ACTUAL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: actual-credentials
              key: password
        - name: ACTUAL_BUDGET_SYNC_ID
          valueFrom:
            secretKeyRef:
              name: actual-credentials
              key: sync-id
        - name: MCP_BRIDGE_DATA_DIR
          value: "/data"
        - name: MCP_BRIDGE_LOG_LEVEL
          value: "info"
        volumeMounts:
        - name: data
          mountPath: /data
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: mcp-data-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: actual-mcp-server
  namespace: default
spec:
  selector:
    app: actual-mcp-server
  ports:
  - protocol: TCP
    port: 3000
    targetPort: 3000
  type: ClusterIP
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mcp-data-pvc
  namespace: default
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

### Create Secrets

```bash
# Create Kubernetes secret
kubectl create secret generic actual-credentials \
  --from-literal=password='your_actual_password' \
  --from-literal=sync-id='your_sync_id'
```

### Ingress (HTTPS)

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: actual-mcp-ingress
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - mcp.yourdomain.com
    secretName: mcp-tls-cert
  rules:
  - host: mcp.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: actual-mcp-server
            port:
              number: 3000
```

## Bare Metal / VM

### System Requirements

- **OS**: Ubuntu 22.04+ / Debian 11+ / RHEL 8+
- **CPU**: 1 core minimum, 2+ recommended
- **RAM**: 512MB minimum, 1GB+ recommended
- **Disk**: 2GB minimum for application + logs
- **Node.js**: Version 20.x LTS

### Installation

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create service user
sudo useradd -r -s /bin/false actual-mcp

# Clone repository
cd /opt
sudo git clone https://github.com/agigante80/actual-mcp-server.git
sudo chown -R actual-mcp:actual-mcp actual-mcp-server
cd actual-mcp-server

# Install dependencies
sudo -u actual-mcp npm install

# Build application
sudo -u actual-mcp npm run build

# Create data and log directories
sudo mkdir -p /var/lib/actual-mcp
sudo mkdir -p /var/log/actual-mcp
sudo chown actual-mcp:actual-mcp /var/lib/actual-mcp
sudo chown actual-mcp:actual-mcp /var/log/actual-mcp
```

### Configuration

```bash
# Create environment file
sudo -u actual-mcp cat > /opt/actual-mcp-server/.env << EOF
ACTUAL_SERVER_URL=http://your-actual-server:5006
ACTUAL_PASSWORD=your_password
ACTUAL_BUDGET_SYNC_ID=your_sync_id
MCP_BRIDGE_DATA_DIR=/var/lib/actual-mcp
MCP_BRIDGE_LOG_DIR=/var/log/actual-mcp
MCP_BRIDGE_STORE_LOGS=true
MCP_BRIDGE_LOG_LEVEL=info
MCP_BRIDGE_PORT=3000
EOF

sudo chmod 600 /opt/actual-mcp-server/.env
```

### Systemd Service

```bash
# Create systemd service
sudo cat > /etc/systemd/system/actual-mcp.service << EOF
[Unit]
Description=Actual MCP Server
After=network.target

[Service]
Type=simple
User=actual-mcp
Group=actual-mcp
WorkingDirectory=/opt/actual-mcp-server
Environment="NODE_ENV=production"
EnvironmentFile=/opt/actual-mcp-server/.env
ExecStart=/usr/bin/node /opt/actual-mcp-server/dist/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=actual-mcp

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable actual-mcp
sudo systemctl start actual-mcp

# Check status
sudo systemctl status actual-mcp
```

### Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/actual-mcp
server {
    listen 80;
    server_name mcp.yourdomain.com;
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name mcp.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/mcp.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.yourdomain.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # SSE endpoint
    location /sse {
        proxy_pass http://localhost:3000/sse;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Production Considerations

### Security

1. **Use HTTPS**: Always use TLS/SSL in production
2. **Enable Authentication**: Set `MCP_SSE_AUTHORIZATION` token
3. **Firewall Rules**: Restrict access to trusted IPs
4. **Secrets Management**: Use Docker secrets, Kubernetes secrets, or vault
5. **Regular Updates**: Keep dependencies and base images updated

### Performance

1. **Resource Limits**: Set appropriate CPU/memory limits
2. **Concurrency**: Adjust adapter concurrency settings if needed
3. **Logging**: Use appropriate log levels (info/warn in production)
4. **Data Directory**: Use fast storage (SSD) for the data directory

### High Availability

1. **Multiple Replicas**: Run 2+ instances behind a load balancer
2. **Health Checks**: Configure liveness and readiness probes
3. **Auto-restart**: Use systemd, Docker restart policies, or K8s deployments
4. **Monitoring**: Set up alerting for service failures

### Backup Strategy

```bash
# Backup Actual data
tar -czf actual-data-backup-$(date +%Y%m%d).tar.gz /var/lib/actual-mcp/

# Backup logs
tar -czf actual-logs-backup-$(date +%Y%m%d).tar.gz /var/log/actual-mcp/

# Automated backup (cron)
0 2 * * * /usr/local/bin/backup-actual-mcp.sh
```

## Monitoring

### Health Check Endpoint

```bash
# Check if server is running
curl http://localhost:3000/health
```

### Prometheus Metrics (If Enabled)

```bash
# View metrics
curl http://localhost:3000/metrics
```

### Log Monitoring

```bash
# Docker logs
docker logs -f actual-mcp-server

# Systemd logs
journalctl -u actual-mcp -f

# Log files
tail -f /var/log/actual-mcp/application.log
```

## Troubleshooting

### Server Won't Start

```bash
# Check logs
docker logs actual-mcp-server
# or
journalctl -u actual-mcp -n 50

# Common issues:
# - Missing environment variables
# - Invalid Actual Budget credentials
# - Network connectivity to Actual server
# - Port already in use
```

### Connection Issues

```bash
# Test Actual Budget connection
npm run dev -- --test-actual-connection

# Check network connectivity
curl http://your-actual-server:5006
```

### Performance Issues

```bash
# Check resource usage
docker stats actual-mcp-server
# or
top -p $(pgrep -f actual-mcp)

# Increase log level for debugging
# Set MCP_BRIDGE_LOG_LEVEL=debug
```

### Data Corruption

```bash
# Remove cached data and re-download
rm -rf /var/lib/actual-mcp/*
# Restart server to re-download budget
```

## Support

For additional help:

- **Documentation**: See `/docs` folder
- **Issues**: https://github.com/agigante80/actual-mcp-server/issues
- **Discussions**: https://github.com/agigante80/actual-mcp-server/discussions
