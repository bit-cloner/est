package main

import (
	"context"
	"fmt"
	"log"

	"github.com/AlecAivazis/survey/v2"
)

func main() {
	var region, clusterName, k8sVersion string
	var useExistingResources bool

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

	// Prompt for Kubernetes version
	promptK8sVersion := &survey.Input{
		Message: "Enter the Kubernetes version (default: 1.31):",
		Default: "1.31",
	}
	if err := survey.AskOne(promptK8sVersion, &k8sVersion); err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Ask whether to use existing resources or create new ones
	err := survey.AskOne(&survey.Confirm{
		Message: "Do you want to use existing AWS resources?",
	}, &useExistingResources)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Fetch AWS Account ID
	fmt.Println("\nFetching AWS Account ID...")
	accountID, callerID, err := GetAWSAccountDetails(context.Background(), region)
	if err != nil {
		log.Fatalf("Error fetching AWS Account ID: %v", err)
	}
	fmt.Printf("AWS Account ID: %s\n", accountID)
	fmt.Printf("Performing operations as the identity %s\n", callerID)

	// EKS Cluster Role
	if err := IamOperations(context.Background(), region, "EKSClusterRole"); err != nil {
		log.Fatalf("Error creating or attaching policies to EKSClusterRole: %v", err)
	}

	// Resource handling
	var vpcID, subnet1, subnet2, igwID, routeTableID, securityGroupID string
	if useExistingResources {
		// Query existing resources
		vpcID = selectExistingResource("VPC", func() ([]string, error) {
			return ListVPCs(context.Background(), region)
		})
		// Select Multiple Subnets
		subnets, err := selectMultipleSubnets(context.Background(), region, vpcID)
		if err != nil {
			log.Fatalf("Error selecting subnets: %v", err)
		}
		if len(subnets) < 2 {
			log.Fatalf("At least two subnets are required for EKS.")
		}
		subnet1, subnet2 = subnets[0], subnets[1]
		fmt.Printf("Using Subnets: %s, %s\n", subnet1, subnet2)
		igwID = selectExistingResource("Internet Gateway", func() ([]string, error) {
			return ListInternetGateways(context.Background(), region, vpcID)
		})
		routeTableID = selectExistingResource("Route Table", func() ([]string, error) {
			return ListRouteTables(context.Background(), region, vpcID)
		})
		securityGroupID = selectExistingResource("Security Group", func() ([]string, error) {
			return ListSecurityGroups(context.Background(), region, vpcID)
		})
	} else {
		// Create new resources
		vpcID, err = CreateVPC(context.Background(), region, "10.0.0.0/16", "EKS-VPC")
		if err != nil {
			log.Fatalf("Error creating VPC: %v", err)
		}
		fmt.Printf("Created VPC ID: %s\n", vpcID)

		subnet1, err = CreateSubnet(context.Background(), region, vpcID, "10.0.1.0/24", "EKS-Subnet-1", "a")
		if err != nil {
			log.Fatalf("Error creating Subnet 1: %v", err)
		}
		subnet2, err = CreateSubnet(context.Background(), region, vpcID, "10.0.2.0/24", "EKS-Subnet-2", "b")
		if err != nil {
			log.Fatalf("Error creating Subnet 2: %v", err)
		}
		fmt.Printf("Created Subnets: %s, %s\n", subnet1, subnet2)

		igwID, err = CreateInternetGateway(context.Background(), region, "EKS-IGW", vpcID)
		if err != nil {
			log.Fatalf("Error creating Internet Gateway: %v", err)
		}
		fmt.Printf("Created Internet Gateway ID: %s\n", igwID)

		routeTableID, err = CreateRouteTable(context.Background(), region, vpcID, "EKS-Route-Table")
		if err != nil {
			log.Fatalf("Error creating Route Table: %v", err)
		}
		fmt.Printf("Created Route Table ID: %s\n", routeTableID)

		securityGroupID, err = CreateSecurityGroup(context.Background(), region, vpcID, "EKS-SG", "EKS Security Group")
		if err != nil {
			log.Fatalf("Error creating Security Group: %v", err)
		}
		fmt.Printf("Created Security Group ID: %s\n", securityGroupID)
	}

	// Create EKS Cluster
	fmt.Println("\nCreating EKS Cluster...")
	err = CreateEKSCluster(context.Background(), region, clusterName, accountID, []string{subnet1, subnet2}, securityGroupID, k8sVersion)
	if err != nil {
		log.Fatalf("Error creating EKS Cluster: %v", err)
	}
	fmt.Printf("EKS Cluster '%s' creation initiated with Kubernetes version %s!\n", clusterName, k8sVersion)
}

// Helper to select existing resource
func selectExistingResource(name string, fetchFunc func() ([]string, error)) string {
	var options []string
	var selected string

	// Fetch available resources
	options, err := fetchFunc()
	if err != nil {
		log.Fatalf("Error fetching %s: %v", name, err)
	}

	// Prompt the user to select one
	prompt := &survey.Select{
		Message: fmt.Sprintf("Select an existing %s:", name),
		Options: options,
	}
	if err := survey.AskOne(prompt, &selected); err != nil {
		log.Fatalf("Error selecting %s: %v", name, err)
	}
	return selected
}
