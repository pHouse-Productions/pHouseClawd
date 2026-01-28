#!/bin/bash
set -e

# Configuration
SECURITY_GROUP="sg-06b3c14c9ecddf960"
SUBNET_ID="subnet-003db240c31c88970"
KEY_NAME="ClawdBot"
KEY_FILE="$HOME/Desktop/ClawdBot.pem"
INSTANCE_TYPE="t3a.large"
REGION="us-east-1"  # Change if different

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=============================================="
echo "   Spin Up New pHouseClawd Instance"
echo "=============================================="
echo ""

# Ask for instance name
read -p "Enter a name for this instance (e.g., vito, jarvis, friday): " INSTANCE_NAME

if [ -z "$INSTANCE_NAME" ]; then
    echo "Error: Instance name cannot be empty"
    exit 1
fi

echo ""
echo "Configuration:"
echo "  Name: $INSTANCE_NAME"
echo "  Type: $INSTANCE_TYPE"
echo "  Region: $REGION"
echo "  Security Group: $SECURITY_GROUP"
echo "  Key: $KEY_NAME"
echo ""

read -p "Proceed? (y/n): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Get latest Ubuntu 24.04 AMI
echo ""
echo -e "${GREEN}==>${NC} Finding latest Ubuntu 24.04 AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
              "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

echo "  Using AMI: $AMI_ID"

# Launch instance
echo ""
echo -e "${GREEN}==>${NC} Launching instance..."
INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP" \
    --subnet-id "$SUBNET_ID" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=pHouseClawd-$INSTANCE_NAME}]" \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
    --query 'Instances[0].InstanceId' \
    --output text)

echo "  Instance ID: $INSTANCE_ID"

# Wait for instance to be running
echo ""
echo -e "${GREEN}==>${NC} Waiting for instance to start..."
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
echo "  Instance is running!"

# Allocate Elastic IP
echo ""
echo -e "${GREEN}==>${NC} Allocating Elastic IP..."
EIP_ALLOC=$(aws ec2 allocate-address \
    --region "$REGION" \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=pHouseClawd-$INSTANCE_NAME}]" \
    --query 'AllocationId' \
    --output text)

EIP_IP=$(aws ec2 describe-addresses \
    --region "$REGION" \
    --allocation-ids "$EIP_ALLOC" \
    --query 'Addresses[0].PublicIp' \
    --output text)

echo "  Elastic IP: $EIP_IP"

# Associate Elastic IP
echo ""
echo -e "${GREEN}==>${NC} Associating Elastic IP with instance..."
aws ec2 associate-address \
    --region "$REGION" \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$EIP_ALLOC" > /dev/null

echo "  Done!"

# Wait a bit for SSH to be ready
echo ""
echo -e "${GREEN}==>${NC} Waiting for SSH to be ready..."
sleep 30

# Output summary
echo ""
echo "=============================================="
echo -e "${GREEN}   Instance Ready!${NC}"
echo "=============================================="
echo ""
echo "Instance ID:  $INSTANCE_ID"
echo "Elastic IP:   $EIP_IP"
echo "Instance:     pHouseClawd-$INSTANCE_NAME"
echo ""
echo "SSH into it:"
echo "  ssh -i $KEY_FILE ubuntu@$EIP_IP"
echo ""
echo "Then run the install script:"
echo "  git clone https://github.com/pHouse-Productions/pHouseClawd.git"
echo "  cd pHouseClawd"
echo "  ./install.sh"
echo ""
echo "For Route53, create an A record:"
echo "  $INSTANCE_NAME.yourdomain.com → $EIP_IP"
echo ""
