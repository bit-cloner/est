package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/AlecAivazis/survey/v2"
)

func main() {
	var region, clusterName, k8sVersion string

	// Prompt for AWS region
	promptRegion := &survey.Input{
		Message: "Enter the AWS region (default: eu-west-2):",
		Default: "eu-west-2",
	}
	if err := survey.AskOne(promptRegion, &region); err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Prompt for EKS Cluster Name
	promptCluster := &survey.Input{
		Message: "Enter the name of the EKS cluster:",
	}
	if err := survey.AskOne(promptCluster, &clusterName, survey.WithValidator(survey.Required)); err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Prompt for K8s version (default 1.31)
	promptK8sVersion := &survey.Input{
		Message: "Enter the Kubernetes version (default: 1.31):",
		Default: "1.31",
	}
	if err := survey.AskOne(promptK8sVersion, &k8sVersion); err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Fetch AWS Account ID
	fmt.Println("\nFetching AWS Account ID...")
	accountID, callerId, err := GetAWSAccountDetails(context.Background(), region)
	if err != nil {
		log.Fatalf("Error fetching AWS Account ID: %v", err)
	}
	fmt.Printf("AWS Account ID: %s\n", accountID)
	fmt.Printf("Performing operations as the identity %s \n", callerId)

	//EKS Cluster role
	IamOperations(context.Background(), region, "EKSClusterRole")

	// VPC
	var vpcID string
	err = promptForResource("VPC", func() (string, error) {
		// Change the CIDR block or name tag as you wish
		return CreateVPC(context.Background(), region, "10.0.0.0/16", "EKS-VPC")
	}, &vpcID)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	fmt.Printf("Using VPC ID: %s\n", vpcID)

	// Subnet 1
	var subnet1 string
	err = promptForResource("Subnet 1", func() (string, error) {
		return CreateSubnet(context.Background(), region, vpcID, "10.0.1.0/24", "EKS-Subnet-1", "a")
	}, &subnet1)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	// Subnet 2
	var subnet2 string
	err = promptForResource("Subnet 2", func() (string, error) {
		return CreateSubnet(context.Background(), region, vpcID, "10.0.2.0/24", "EKS-Subnet-2", "b")
	}, &subnet2)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	fmt.Printf("Using Subnets: %s, %s\n", subnet1, subnet2)

	// Internet Gateway
	var igwID string
	err = promptForResource("Internet Gateway", func() (string, error) {
		return CreateInternetGateway(context.Background(), region, "EKS-IGW", vpcID)
	}, &igwID)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	fmt.Printf("Using Internet Gateway ID: %s\n", igwID)

	// Route Table
	var routeTableID string
	err = promptForResource("Route Table", func() (string, error) {
		return CreateRouteTable(context.Background(), region, vpcID, "EKS-Route-Table")
	}, &routeTableID)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	fmt.Printf("Using Route Table ID: %s\n", routeTableID)

	// Associate Route Table + Public IP for Subnets
	// (You may want to conditionally do these if subnets were newly created,
	//  but here we do them unconditionally for simplicity.)
	fmt.Println("\nConfiguring Subnets...")
	if err := AssociateRouteTable(context.Background(), region, routeTableID, subnet1); err != nil {
		log.Fatalf("Error associating Route Table to Subnet 1: %v", err)
	}
	if err := AssociateRouteTable(context.Background(), region, routeTableID, subnet2); err != nil {
		log.Fatalf("Error associating Route Table to Subnet 2: %v", err)
	}
	if err := ModifySubnetForPublicIP(context.Background(), region, subnet1); err != nil {
		log.Fatalf("Error enabling public IP for Subnet 1: %v", err)
	}
	if err := ModifySubnetForPublicIP(context.Background(), region, subnet2); err != nil {
		log.Fatalf("Error enabling public IP for Subnet 2: %v", err)
	}

	// Security Group
	var securityGroupID string
	err = promptForResource("Security Group", func() (string, error) {
		return CreateSecurityGroup(context.Background(), region, vpcID, "EKS-SG", "EKS Security Group")
	}, &securityGroupID)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}
	fmt.Printf("Using Security Group ID: %s\n", securityGroupID)

	// Create EKS Cluster
	fmt.Println("\nCreating EKS Cluster...")
	err = CreateEKSCluster(context.Background(), region, clusterName, accountID, []string{subnet1, subnet2}, securityGroupID, k8sVersion)
	if err != nil {
		log.Fatalf("Error creating EKS Cluster: %v", err)
	}
	fmt.Printf("EKS Cluster '%s' creation initiated with Kubernetes version %s!\n", clusterName, k8sVersion)
}

// promptForResource is a helper to create or reuse a resource.
func promptForResource(
	name string,
	createFunc func() (string, error),
	resourceID *string,
) error {
	var useExisting bool
	var input string

	// Prompt whether to reuse an existing resource or create a new one
	err := survey.AskOne(&survey.Confirm{
		Message: fmt.Sprintf("Do you want to provide an existing %s ID?", name),
	}, &useExisting)
	if err != nil {
		return err
	}

	if useExisting {
		// Prompt for existing resource ID
		err = survey.AskOne(&survey.Input{
			Message: fmt.Sprintf("Enter the %s ID:", name),
		}, &input, survey.WithValidator(survey.Required))
		if err != nil {
			return err
		}
		*resourceID = strings.TrimSpace(input)
	} else {
		// Create a new resource
		fmt.Printf("Creating a new %s...\n", name)
		createdID, err := createFunc()
		if err != nil {
			return err
		}
		*resourceID = createdID
		fmt.Printf("Created %s with ID: %s\n", name, createdID)
	}
	return nil
}
