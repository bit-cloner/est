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
		//prompt for auto mode enabled or not
		var autoMode = true
		autoModePrompt := &survey.Confirm{
			Message: "Do you want to enable auto mode for the cluster? Default: Yes",
		}
		if err := survey.AskOne(autoModePrompt, &autoMode); err != nil {
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

		// Create EKS Cluster
		fmt.Println("\nCreating EKS Cluster...")
		err = CreateEKSCluster(context.Background(), region, clusterName, accountID, subnets, securityGroups, k8sVersion, vpcID, autoMode)
		if err != nil {
			log.Fatalf("Error creating EKS Cluster: %v", err)
		}
		//Ask to install addons
		var createAddons = true
		confirmPrompt := &survey.Confirm{
			Message: "Do you want to install CoreDNS, Kubeproxy, VPC_CNI  addons ? Default: Yes",
		}
		if err := survey.AskOne(confirmPrompt, &createAddons); err != nil {
			log.Fatalf("Error: %v", err)
		}

		if createAddons {
			// Add code to install 3 addons
			err = InstallAddons(context.Background(), region, clusterName)
			if err != nil {
				log.Fatalf("Error installing addons: %v", err)
			}
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
			var confirmDeleteVPC = true
			askVpcDeletePrompt := &survey.Confirm{
				Message: "Do you want to delte VPC and all dependent objects in it? Default: Yes",
				Default: confirmDeleteVPC,
			}
			if err := survey.AskOne(askVpcDeletePrompt, &confirmDeleteVPC); err != nil {
				log.Fatalf("Error: %v", err)
			}
			if confirmDeleteVPC {
				// Proceed to delete the cluster
				err = DeleteEKSCluster(context.Background(), region, selectedCluster)
				if err != nil {
					log.Fatalf("Error deleting cluster: %v", err)
				}

				fmt.Printf("Cluster '%s' deletion initiated successfully.\n", selectedCluster)

				// write delete VPC function passing VPc id as input

				err = DeleteVPC(context.Background(), region, vpcId)
				if err != nil {
					log.Fatalf("Error deleting VPC: %v", err)
				}
				fmt.Println("VPC and all components of the VPC deleted")
			} else {
				fmt.Println("Deleting just the cluster and leaving VPC intact")
				err = DeleteEKSCluster(context.Background(), region, selectedCluster)
				if err != nil {
					log.Fatalf("Error deleting cluster: %v", err)
				}

				fmt.Printf("Cluster '%s' deletion initiated successfully.\n", selectedCluster)
			}
		}

	}

}
