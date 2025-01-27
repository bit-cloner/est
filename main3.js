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
	// Prompt the user to choose between creating or deleting a cluster
	var action string
	actionPrompt := &survey.Select{
		Message: "What action do you want to perform?",
		Options: []string{"Create Cluster", "Delete Cluster"},
	}
	if err := survey.AskOne(actionPrompt, &action); err != nil {
		log.Fatalf("Error: %v", err)
	}

	switch action {
	case "Create Cluster":
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
			Message: "Do you want to create a cluster in existing VPC and subnets etc..? (Recommended No)",
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
			err = EnableAutoAssignPublicIP(context.Background(), region, subnets)
			if err != nil {
				log.Fatalf("Error enabling auto-assign public IPv4: %v", err)
			}
			fmt.Println("Successfully enabled auto-assign public IPv4 for all subnets.")
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

			CreateRoute(context.Background(), region, routeTableID, "0.0.0.0/0", igwID)
			AssociateRouteTable(context.Background(), region, routeTableID, subnet1)
			AssociateRouteTable(context.Background(), region, routeTableID, subnet2)

			sgID, err := CreateSecurityGroup(context.Background(), region, vpcID, "EKS-SG", "EKS Security Group")
			if err != nil {
				log.Fatalf("Error creating Security Group: %v", err)
			}
			securityGroups = []string{sgID}
			fmt.Printf("Created Security Group ID: %s\n", sgID)
		}

		// Create EKS Cluster
		fmt.Println("\nCreating EKS Cluster...")
		err = CreateEKSCluster(context.Background(), region, clusterName, accountID, subnets, securityGroups, k8sVersion, useExistingResources, vpcID)
		if err != nil {
			log.Fatalf("Error creating EKS Cluster: %v", err)
		}

	case "Delete Cluster":
		// Logic for deleting a cluster
		promptRegion := &survey.Input{
			Message: "Enter the AWS region (default: eu-west-2):",
			Default: "eu-west-2",
		}
		if err := survey.AskOne(promptRegion, &region); err != nil {
			log.Fatalf("Error: %v", err)
		}

		// Fetch existing clusters
		clusters, err := ListEKSClusters(context.Background(), region)
		if err != nil {
			log.Fatalf("Error fetching clusters: %v", err)
		}

		if len(clusters) == 0 {
			fmt.Println("No clusters found in the specified region.")
			return
		}

		// Prompt the user to select a cluster to delete
		var selectedCluster string
		clusterPrompt := &survey.Select{
			Message: "Select the cluster to delete:",
			Options: clusters,
		}
		if err := survey.AskOne(clusterPrompt, &selectedCluster); err != nil {
			log.Fatalf("Error: %v", err)
		}

		// Check if the cluster has the required "CreatedBy" tag
		isCreatedByTool, err := CheckClusterTag(context.Background(), region, selectedCluster, "CreatedBy", "EKS-Sandbox-Tool")
		if err != nil {
			log.Fatalf("Error checking cluster tags: %v", err)
		}
		fmt.Println(isCreatedByTool)
		if !isCreatedByTool {
			// Warn the user
			var confirmDelete bool
			warningPrompt := &survey.Confirm{
				Message: "This cluster does not appear to be created by this tool. Are you sure you want to delete it? Danger!!",
			}
			if err := survey.AskOne(warningPrompt, &confirmDelete); err != nil {
				log.Fatalf("Error: %v", err)
			}

			if !confirmDelete {
				fmt.Println("Cluster deletion aborted.")
				return
			}
		}
		isIsolatedVpc, err := CheckClusterTag(context.Background(), region, selectedCluster, "HostingVPC", "isolated")
		if err != nil {
			log.Fatalf("Error checking cluster tags: %v", err)
		}
		if isIsolatedVpc {
			vpcId, err := GetVPCIDFromCluster(context.Background(), region, selectedCluster)
			if err != nil {
				log.Fatalf("Error getting VpcId from cluster tags: %v", err)
			}

			//delete VPC too
			var confirmDeleteVPC bool
			askVpcDeletePrompt := &survey.Confirm{
				Message: "This cluster seems to be using isolated VPC . Do you want to delte VPC and all dependent objects in it?",
			}
			if err := survey.AskOne(askVpcDeletePrompt, &confirmDeleteVPC); err != nil {
				log.Fatalf("Error: %v", err)
			}
			if confirmDeleteVPC {
				// write delete VPC function passing VPc id as input

				err = DeleteVPC(context.Background(), region, vpcId)
				if err != nil {
					log.Fatalf("Error deleting VPC: %v", err)
				}
				fmt.Println("VPC and all components of the VPC deleted")
			}
		}

		// Proceed to delete the cluster
		err = DeleteEKSCluster(context.Background(), region, selectedCluster)
		if err != nil {
			log.Fatalf("Error deleting cluster: %v", err)
		}

		fmt.Printf("Cluster '%s' deletion initiated successfully.\n", selectedCluster)

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
