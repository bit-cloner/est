# EKS Sandbox Tool

A command-line interface (CLI) tool for quickly creating and deleting Amazon EKS  sandbox environments with isolated networking. Used for POC and troubleshooting tasks.

## Features

- **One-Command Cluster Creation**: Creates a complete EKS environment including:
  - Isolated VPC with custom CIDR
  - Public subnets across two availability zones
  - Internet Gateway for external connectivity
  - Route tables and security groups
  - EKS cluster with Latest or specific  Kubernetes version
  - Required IAM roles and policies

- **Auto Mode Support**: Option to enable AWS EKS Auto mode features:
  - Managed compute
  - Managed storage
  - Load balancer integration
  - Network policy management

- **Addon Management**: Automatic installation of essential EKS add-ons:
  - CoreDNS for DNS management
  - kube-proxy for network proxying
  - Amazon VPC CNI for pod networking

- **Clean Environment Deletion**: Removes all created resources:
  - EKS cluster
  - VPC and associated networking components
  - Security groups
  - Route tables and internet gateway

## Installation

Download the appropriate binary for your operating system and CPU architecture:


### For Apple Silicon MAC OS (arm64)

```sh
VERSION=$(curl -sL -o /dev/null -w %{url_effective} https://github.com/bit-cloner/est/releases/latest | sed 's#.*/tag/##')


curl -LO https://github.com/bit-cloner/est/releases/download/$VERSION/est-$VERSION-darwin-arm64.tar.gz

tar -xzf est-$VERSION-darwin-arm64.tar.gz

chmod +x est

./est
```

### For Intel-based MAC OS
```sh
VERSION=$(curl -sL -o /dev/null -w %{url_effective} https://github.com/bit-cloner/est/releases/latest | sed 's#.*/tag/##')


curl -LO https://github.com/bit-cloner/est/releases/download/$VERSION/est-$VERSION-darwin-amd64.tar.gz

tar -xzf est-$VERSION-darwin-amd64.tar.gz
chmod +x est

./est
```



## Linux

### For x86_64 systems
```sh

VERSION=$(curl -sL -o /dev/null -w %{url_effective} https://github.com/bit-cloner/est/releases/latest | sed 's#.*/tag/##')


curl -LO https://github.com/bit-cloner/est/releases/download/$VERSION/est-$VERSION-linux-amd64.tar.gz

tar -xzf est-$VERSION-linux-amd64.tar.gz

chmod +x est

./est

```
### For ARM64 systems
```sh
VERSION=$(curl -sL -o /dev/null -w %{url_effective} https://github.com/bit-cloner/est/releases/latest | sed 's#.*/tag/##')


curl -LO https://github.com/bit-cloner/est/releases/download/$VERSION/est-V$ERSION-linux-arm64.tar.gz

tar -xzf est-$VERSION-linux-amd64.tar.gz

chmod +x est

./est

```

## Windows
```sh
# For 64-bit systems
$VERSION = (Invoke-WebRequest -Uri "https://github.com/bit-cloner/est/releases/latest" -UseBasicParsing).BaseResponse.ResponseUri -replace ".*/tag/", ""

Invoke-WebRequest -Uri https://github.com/bit-cloner/est/releases/download/$VERSION/est-$VERSION-windows-amd64.zip -OutFile est.zip

Expand-Archive -Path est.zip -DestinationPath .

# For 32-bit systems
$VERSION = (Invoke-WebRequest -Uri "https://github.com/bit-cloner/est/releases/latest" -UseBasicParsing).BaseResponse.ResponseUri -replace ".*/tag/", ""

Invoke-WebRequest -Uri https://github.com/bit-cloner/est/releases/download/$VERSION/est-$VERSION-windows-386.zip -OutFile est.zip

Expand-Archive -Path est.zip -DestinationPath .
```

## Prerequisites

- AWS CLI installed and configured with appropriate credentials
- Suitable IAM permissions to create:
  - VPC and networking components
  - EKS clusters
  - IAM roles and policies

## Usage

### Creating a Cluster

Follow the interactive prompts to:

1. Select "Create Cluster"
2. Enter AWS region (defaults to `eu-west-1`)
3. Provide cluster name
4. Choose Kubernetes version (defaults to latest available)
5. Enable/disable auto mode
6. Configure add-ons

### Deleting a Cluster

Follow the interactive prompts to:

1. Select "Delete Cluster"
2. Choose AWS region
3. Select cluster to delete
4. Confirm VPC deletion (if applicable)

## Use Cases

### Development and Testing

- Create isolated environments for testing applications
- Experiment with EKS features and configurations
- Validate Kubernetes deployments

### Training and Learning

- Set up temporary clusters for Kubernetes training
- Practice EKS administration
- Learn about AWS networking concepts

### CI/CD Pipeline Testing

- Create ephemeral clusters for integration testing
- Validate infrastructure as code
- Test deployment automation

### Demo Environments

- Quickly spin up demo environments
- Showcase applications in isolated networks
- Clean up resources after demonstrations

## Security Considerations

- The tool creates security groups that allow all inbound traffic by default
- Clusters are created with public endpoint access
- Auto mode enables various AWS managed features
- Review and modify security settings for production use

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

