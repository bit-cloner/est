package main

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	ec2 "github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	eks "github.com/aws/aws-sdk-go-v2/service/eks"
	"github.com/aws/aws-sdk-go-v2/service/eks/types"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	iamtypes "github.com/aws/aws-sdk-go-v2/service/iam/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// GetAWSAccountDetails retrieves the AWS Account ID and the caller's identity (ARN) using the STS GetCallerIdentity API.
func GetAWSAccountDetails(ctx context.Context, region string) (string, string, error) {
	// Load default configuration with specified region
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", "", fmt.Errorf("unable to load AWS configuration: %v", err)
	}

	// Create STS client
	stsClient := sts.NewFromConfig(cfg)

	// Call GetCallerIdentity to retrieve account information
	output, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return "", "", fmt.Errorf("failed to get caller identity: %v", err)
	}

	// Return the Account ID and Caller Identity (ARN)
	return aws.ToString(output.Account), aws.ToString(output.Arn), nil
}

func IamOperations(ctx context.Context, region, roleName string) error {
	// Load default AWS configuration
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return fmt.Errorf("unable to load AWS configuration: %v", err)
	}

	iamClient := iam.NewFromConfig(cfg)

	// Define the assume role policy document
	assumeRolePolicy := `{
		"Version": "2012-10-17",
		"Statement": [
			{
				"Effect": "Allow",
				"Principal": {
					"Service": "eks.amazonaws.com"
				},
				"Action": "sts:AssumeRole"
			}
		]
	}`

	// Try to create the IAM role
	_, err = iamClient.CreateRole(ctx, &iam.CreateRoleInput{
		RoleName:                 aws.String(roleName),
		AssumeRolePolicyDocument: aws.String(assumeRolePolicy),
	})
	if err != nil {
		var alreadyExists *iamtypes.EntityAlreadyExistsException
		if !errors.As(err, &alreadyExists) {
			return fmt.Errorf("failed to create role %s: %v", roleName, err)
		}
		fmt.Printf("Role %s already exists. Proceeding...\n", roleName)
	} else {
		fmt.Printf("Successfully created role: %s\n", roleName)
	}

	// Attach the required policies
	policies := []string{
		"arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
		"arn:aws:iam::aws:policy/AmazonEKSVPCResourceController",
	}
	for _, policyArn := range policies {
		_, err := iamClient.AttachRolePolicy(ctx, &iam.AttachRolePolicyInput{
			RoleName:  aws.String(roleName),
			PolicyArn: aws.String(policyArn),
		})
		if err != nil {
			return fmt.Errorf("failed to attach policy %s to role %s: %v", policyArn, roleName, err)
		}
		fmt.Printf("Attached policy %s to role %s\n", policyArn, roleName)
	}

	return nil
}

// CreateVPC creates a new VPC with the provided CIDR and name
func CreateVPC(ctx context.Context, region, cidr, name string) (string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", err
	}
	client := ec2.NewFromConfig(cfg)

	output, err := client.CreateVpc(ctx, &ec2.CreateVpcInput{
		CidrBlock: aws.String(cidr),
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeVpc,
				Tags: []ec2types.Tag{
					{Key: aws.String("Name"), Value: aws.String(name)},
					{Key: aws.String("CreatedBy"), Value: aws.String("EKS-Sandbox-Tool")},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}

	return aws.ToString(output.Vpc.VpcId), nil
}

// CreateSubnet creates a subnet with the provided parameters
func CreateSubnet(ctx context.Context, region, vpcID, cidr, name, azSuffix string) (string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", err
	}
	client := ec2.NewFromConfig(cfg)

	output, err := client.CreateSubnet(ctx, &ec2.CreateSubnetInput{
		VpcId:            aws.String(vpcID),
		CidrBlock:        aws.String(cidr),
		AvailabilityZone: aws.String(region + azSuffix),
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeSubnet,
				Tags: []ec2types.Tag{
					{Key: aws.String("Name"), Value: aws.String(name)},
					{Key: aws.String("CreatedBy"), Value: aws.String("EKS-Sandbox-Tool")},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}

	return aws.ToString(output.Subnet.SubnetId), nil
}

// CreateInternetGateway creates and attaches an Internet Gateway to the VPC
func CreateInternetGateway(ctx context.Context, region, name, vpcID string) (string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", err
	}
	client := ec2.NewFromConfig(cfg)

	// Create the Internet Gateway
	igwOutput, err := client.CreateInternetGateway(ctx, &ec2.CreateInternetGatewayInput{
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeInternetGateway,
				Tags: []ec2types.Tag{
					{Key: aws.String("Name"), Value: aws.String(name)},
					{Key: aws.String("CreatedBy"), Value: aws.String("EKS-Sandbox-Tool")},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}

	igwID := aws.ToString(igwOutput.InternetGateway.InternetGatewayId)

	// Attach the Internet Gateway to the VPC
	_, err = client.AttachInternetGateway(ctx, &ec2.AttachInternetGatewayInput{
		InternetGatewayId: aws.String(igwID),
		VpcId:             aws.String(vpcID),
	})
	if err != nil {
		return "", err
	}

	return igwID, nil
}

// CreateRouteTable creates a route table and associates it with the given VPC
func CreateRouteTable(ctx context.Context, region, vpcID, name string) (string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", err
	}
	client := ec2.NewFromConfig(cfg)

	output, err := client.CreateRouteTable(ctx, &ec2.CreateRouteTableInput{
		VpcId: aws.String(vpcID),
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeRouteTable,
				Tags: []ec2types.Tag{
					{Key: aws.String("Name"), Value: aws.String(name)},
					{Key: aws.String("CreatedBy"), Value: aws.String("EKS-Sandbox-Tool")},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}

	return aws.ToString(output.RouteTable.RouteTableId), nil
}

// CreateRoute creates a route to the Internet Gateway
func CreateRoute(ctx context.Context, region, routeTableID, cidr, igwID string) error {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return err
	}
	client := ec2.NewFromConfig(cfg)

	_, err = client.CreateRoute(ctx, &ec2.CreateRouteInput{
		RouteTableId:         aws.String(routeTableID),
		DestinationCidrBlock: aws.String(cidr),
		GatewayId:            aws.String(igwID),
	})
	return err
}

// AssociateRouteTable associates a route table with a subnet
func AssociateRouteTable(ctx context.Context, region, routeTableID, subnetID string) error {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return err
	}
	client := ec2.NewFromConfig(cfg)

	_, err = client.AssociateRouteTable(ctx, &ec2.AssociateRouteTableInput{
		RouteTableId: aws.String(routeTableID),
		SubnetId:     aws.String(subnetID),
	})
	return err
}

// ModifySubnetForPublicIP enables auto-assign public IP for a subnet
func ModifySubnetForPublicIP(ctx context.Context, region, subnetID string) error {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return err
	}
	client := ec2.NewFromConfig(cfg)

	_, err = client.ModifySubnetAttribute(ctx, &ec2.ModifySubnetAttributeInput{
		SubnetId:            aws.String(subnetID),
		MapPublicIpOnLaunch: &ec2types.AttributeBooleanValue{Value: aws.Bool(true)},
	})
	return err
}

// CreateSecurityGroup creates a security group in the given VPC
func CreateSecurityGroup(ctx context.Context, region, vpcID, name, description string) (string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", err
	}
	client := ec2.NewFromConfig(cfg)

	output, err := client.CreateSecurityGroup(ctx, &ec2.CreateSecurityGroupInput{
		GroupName:   aws.String(name),
		Description: aws.String(description),
		VpcId:       aws.String(vpcID),
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeSecurityGroup,
				Tags: []ec2types.Tag{
					{Key: aws.String("Name"), Value: aws.String(name)},
					{Key: aws.String("CreatedBy"), Value: aws.String("EKS-Sandbox-Tool")},
				},
			},
		},
	})
	if err != nil {
		return "", err
	}

	return aws.ToString(output.GroupId), nil
}

// AuthorizeAllTraffic allows all inbound traffic for a security group
func AuthorizeAllTraffic(ctx context.Context, region, sgID string) error {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return err
	}
	client := ec2.NewFromConfig(cfg)

	_, err = client.AuthorizeSecurityGroupIngress(ctx, &ec2.AuthorizeSecurityGroupIngressInput{
		GroupId: aws.String(sgID),
		IpPermissions: []ec2types.IpPermission{
			{
				IpProtocol: aws.String("-1"),
				IpRanges: []ec2types.IpRange{
					{CidrIp: aws.String("0.0.0.0/0")},
				},
			},
		},
	})
	return err
}

// CreateEKSCluster creates an EKS cluster with the provided parameters
func CreateEKSCluster(ctx context.Context, region, clusterName, accountID string, subnetIDs, securityGroupIDs []string, k8sVersion string) error {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return err
	}
	client := eks.NewFromConfig(cfg)

	roleArn := fmt.Sprintf("arn:aws:iam::%s:role/EKSClusterRole", accountID)
	tags := map[string]string{
		"CreatedBy": "EKS-Sandbox-Tool",
	}

	_, err = client.CreateCluster(ctx, &eks.CreateClusterInput{
		Name:    aws.String(clusterName),
		Version: &k8sVersion,
		RoleArn: aws.String(roleArn),
		ResourcesVpcConfig: &types.VpcConfigRequest{
			SubnetIds:        subnetIDs,
			SecurityGroupIds: securityGroupIDs,
		},
		Tags: tags, // Add tags here
	})
	if err != nil {
		return fmt.Errorf("failed to create EKS cluster: %v", err)
	}

	fmt.Printf("EKS Cluster '%s' creation initiated with Kubernetes version %s \n", clusterName, k8sVersion)
	return nil
}

// ListVPCs returns a list of VPC IDs
func ListVPCs(ctx context.Context, region string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	ec2Client := ec2.NewFromConfig(cfg)

	output, err := ec2Client.DescribeVpcs(ctx, &ec2.DescribeVpcsInput{})
	if err != nil {
		return nil, err
	}

	var vpcs []string
	for _, vpc := range output.Vpcs {
		vpcs = append(vpcs, aws.ToString(vpc.VpcId))
	}
	return vpcs, nil
}

// ListSubnets returns a list of Subnet IDs for a given VPC
func ListSubnets(ctx context.Context, region, vpcID string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	ec2Client := ec2.NewFromConfig(cfg)

	output, err := ec2Client.DescribeSubnets(ctx, &ec2.DescribeSubnetsInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("vpc-id"),
				Values: []string{vpcID},
			},
		},
	})
	if err != nil {
		return nil, err
	}

	var subnets []string
	for _, subnet := range output.Subnets {
		subnets = append(subnets, aws.ToString(subnet.SubnetId))
	}
	return subnets, nil
}

// ListInternetGateways returns a list of Internet Gateway IDs for a given VPC
func ListInternetGateways(ctx context.Context, region, vpcID string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	ec2Client := ec2.NewFromConfig(cfg)

	output, err := ec2Client.DescribeInternetGateways(ctx, &ec2.DescribeInternetGatewaysInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("attachment.vpc-id"),
				Values: []string{vpcID},
			},
		},
	})
	if err != nil {
		return nil, err
	}

	var gateways []string
	for _, igw := range output.InternetGateways {
		gateways = append(gateways, aws.ToString(igw.InternetGatewayId))
	}
	return gateways, nil
}

// ListRouteTables returns a list of Route Table IDs for a given VPC
func ListRouteTables(ctx context.Context, region, vpcID string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	ec2Client := ec2.NewFromConfig(cfg)

	output, err := ec2Client.DescribeRouteTables(ctx, &ec2.DescribeRouteTablesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("vpc-id"),
				Values: []string{vpcID},
			},
		},
	})
	if err != nil {
		return nil, err
	}

	var routeTables []string
	for _, rtb := range output.RouteTables {
		routeTables = append(routeTables, aws.ToString(rtb.RouteTableId))
	}
	return routeTables, nil
}

// ListSecurityGroups returns a list of Security Group IDs for a given VPC
func ListSecurityGroups(ctx context.Context, region, vpcID string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}
	ec2Client := ec2.NewFromConfig(cfg)

	output, err := ec2Client.DescribeSecurityGroups(ctx, &ec2.DescribeSecurityGroupsInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("vpc-id"),
				Values: []string{vpcID},
			},
		},
	})
	if err != nil {
		return nil, err
	}

	var securityGroups []string
	for _, sg := range output.SecurityGroups {
		securityGroups = append(securityGroups, aws.ToString(sg.GroupId))
	}
	return securityGroups, nil
}

// GetLatestEKSVersion fetches all available EKS versions and returns the latest one.
func GetLatestEKSVersion(ctx context.Context, region string) (string, error) {
	// Load AWS configuration
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return "", fmt.Errorf("unable to load AWS configuration: %v", err)
	}
	client := eks.NewFromConfig(cfg)

	// Define input to fetch all available versions
	input := &eks.DescribeClusterVersionsInput{
		IncludeAll: aws.Bool(true), // Include all versions, not just the defaults
	}

	// Call DescribeClusterVersions
	output, err := client.DescribeClusterVersions(ctx, input)
	if err != nil {
		return "", fmt.Errorf("failed to fetch EKS cluster versions: %v", err)
	}

	if len(output.ClusterVersions) == 0 {
		return "", fmt.Errorf("no available EKS versions found")
	}

	// Extract versions from ClusterVersionInformation
	var versions []string
	for _, versionInfo := range output.ClusterVersions {
		if versionInfo.ClusterVersion != nil {
			versions = append(versions, *versionInfo.ClusterVersion)
		}
	}

	if len(versions) == 0 {
		return "", fmt.Errorf("no valid EKS versions found in the response")
	}

	// Sort the versions to get the latest
	latest := getLatestVersion(versions)

	return latest, nil
}

// getLatestVersion returns the latest version from a slice of version strings
func getLatestVersion(versions []string) string {
	// Sort versions lexicographically
	sort.Slice(versions, func(i, j int) bool {
		// Compare versions as semantic version strings (e.g., "1.27" > "1.26")
		return versions[i] > versions[j]
	})

	return versions[0] // Latest version is the first after sorting
}
