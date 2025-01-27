package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/AlecAivazis/survey/v2"
)

func main() {
	var region, clusterName, k8sVersion string
	var useExistingResources bool

	// Prompt for AWS region
	promptRegion := &survey.Input{
		Message: "Enter the AWS region default:",
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
	clusterName = "Sandbox-" + clusterName
	// Fetch the latest EKS version from AWS
	latestVersion, err := GetLatestEKSVersion(context.Background(), region)
	if err != nil {
		log.Fatalf("Error fetching latest EKS version: %v", err)
	}
	// Prompt for Kubernetes version
	promptK8sVersion := &survey.Input{
		Message: "Enter the Kubernetes version default:",
		Default: latestVersion,
	}
	if err := survey.AskOne(promptK8sVersion, &k8sVersion); err != nil {
		log.Fatalf("Error: %v", err)
	}

	// Ask whether to use existing resources or create new ones
	err = survey.AskOne(&survey.Confirm{
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
	var vpcID, igwID, routeTableID string
	var subnets []string
	var securityGroups []string

	if useExistingResources {
		// Select an existing VPC
		vpcID = selectExistingResource("VPC", func() ([]string, error) {
			return ListVPCs(context.Background(), region)
		})

		// Select multiple subnets
		selectedSubnets, err := selectMultipleSubnets(context.Background(), region, vpcID)
		if err != nil {
			log.Fatalf("Error selecting subnets: %v", err)
		}
		if len(selectedSubnets) < 2 {
			log.Fatalf("At least two subnets are required for EKS.")
		}
		subnets = selectedSubnets
		fmt.Printf("Using Subnets: %v\n", subnets)

		// Select multiple Security Groups
		selectedSecurityGroups, err := selectMultipleSecurityGroups(context.Background(), region, vpcID)
		if err != nil {
			log.Fatalf("Error selecting security groups: %v", err)
		}
		securityGroups = selectedSecurityGroups
		fmt.Printf("Using Security Groups: %v\n", securityGroups)

	} else {
		// Create new resources
		currentDate := time.Now().Format("2006-01-02")            // Format the date as YYYY-MM-DD
		vpcName := fmt.Sprintf("Sandbox-EKS-VPC-%s", currentDate) // Append the date to "EKS-VPC"
		vpcID, err = CreateVPC(context.Background(), region, "10.0.0.0/16", vpcName)
		if err != nil {
			log.Fatalf("Error creating VPC: %v", err)
		}
		fmt.Printf("Created VPC ID: %s\n", vpcID)

		subnet1, err := CreateSubnet(context.Background(), region, vpcID, "10.0.1.0/24", "EKS-Subnet-1", "a")
		if err != nil {
			log.Fatalf("Error creating Subnet 1: %v", err)
		}
		subnet2, err := CreateSubnet(context.Background(), region, vpcID, "10.0.2.0/24", "EKS-Subnet-2", "b")
		if err != nil {
			log.Fatalf("Error creating Subnet 2: %v", err)
		}
		subnets = []string{subnet1, subnet2}
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

		sgID, err := CreateSecurityGroup(context.Background(), region, vpcID, "EKS-SG", "EKS Security Group")
		if err != nil {
			log.Fatalf("Error creating Security Group: %v", err)
		}
		securityGroups = []string{sgID}
		fmt.Printf("Created Security Group ID: %s\n", sgID)
	}

	// Create EKS Cluster
	fmt.Println("\nCreating EKS Cluster...")
	err = CreateEKSCluster(context.Background(), region, clusterName, accountID, subnets, securityGroups, k8sVersion)
	if err != nil {
		log.Fatalf("Error creating EKS Cluster: %v", err)
	}

}

// Helper to select an existing single resource
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

// Helper to select multiple subnets
func selectMultipleSubnets(ctx context.Context, region, vpcID string) ([]string, error) {
	subnets, err := ListSubnets(ctx, region, vpcID)
	if err != nil {
		return nil, err
	}

	var selectedSubnets []string
	prompt := &survey.MultiSelect{
		Message: "Select subnets to use:",
		Options: subnets,
	}
	if err := survey.AskOne(prompt, &selectedSubnets); err != nil {
		return nil, err
	}

	return selectedSubnets, nil
}

// Helper to select multiple security groups
func selectMultipleSecurityGroups(ctx context.Context, region, vpcID string) ([]string, error) {
	sgs, err := ListSecurityGroups(ctx, region, vpcID)
	if err != nil {
		return nil, err
	}

	var selectedSGs []string
	prompt := &survey.MultiSelect{
		Message: "Select security groups to use:",
		Options: sgs,
	}
	if err := survey.AskOne(prompt, &selectedSGs); err != nil {
		return nil, err
	}

	return selectedSGs, nil
}
