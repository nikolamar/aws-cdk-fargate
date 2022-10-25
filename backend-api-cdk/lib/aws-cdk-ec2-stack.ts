import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as certm from "@aws-cdk/aws-certificatemanager";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import * as route53 from "@aws-cdk/aws-route53";
import * as ecs from "@aws-cdk/aws-ecs";
import * as log from "@aws-cdk/aws-logs";
import * as route53Targets from "@aws-cdk/aws-route53-targets";

/**
 * 👇 Domain name
 */
 const domainName = "nikolatec.com"

 /**
  * 👇 Prefix for all resources
  */
 const projectName = "backend-api";

export class AwsCdkEc2Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * 👇 If you create a new VPC,
     * be aware that the CDK will create Nat Gateways
     * for you that costs quite a lot in the long run.
     * Add natGateways:0 to your VPC to not deploy any Nat Gateways.
     * Build VPC construction and place ALB in public subnet
     */
    const vpc = new ec2.Vpc(this, `${projectName}-vpc`, {
      cidr: "10.1.0.0/16",
      vpcName: `${projectName}-vpc`,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "PublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "PrivateIsolatedSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    /**
     * 👇 Create a ELB security group for balancer.
     */
    const securityGroupELB = new ec2.SecurityGroup(this, `${projectName}-security-group-elb`, {
      vpc,
      securityGroupName: `${projectName}-security-group-elb`,
    });

    /**
     * 👇 Add inbound permission to the security group.
     * HTTPS port 443 is required to access the application.
     */
    securityGroupELB.addIngressRule(
      ec2.Peer.ipv4("0.0.0.0/0"),
      ec2.Port.tcp(443),
      "allow HTTPS traffic from anywhere",
    );

    /**
     * 👇 Create aapp security group.
     */
    const securityGroupApp = new ec2.SecurityGroup(this, `${projectName}-security-group-app`, {
      vpc,
      securityGroupName: `${projectName}-security-group-app`,
    });

    /**
     * 👇 Create hosted zone
     */
    const hostedZone = route53.HostedZone.fromLookup(this, `${projectName}-hosted-zone`, {
      domainName: domainName,
    });

    /**
     * 👇 Create a certificate
     */
    const cert = new certm.DnsValidatedCertificate(this, `${projectName}-certificate`, {
      domainName: domainName,
      hostedZone,
      region: "us-east-1",
    });

    /**
     * 👇 Create a load balancer
     */
    const alb = new elbv2.ApplicationLoadBalancer(this, `${projectName}-alb`, {
      vpc,
      internetFacing: true,
      securityGroup: securityGroupELB,
      loadBalancerName: `${projectName}-alb`,
    });


    /**
     * 👇 Create a http listener
     */
    const listenerHTTP = alb.addListener(`${projectName}-listener-http`, {
      port: 443,
      certificates: [
        {
          certificateArn: cert.certificateArn,
        },
      ],
    });

    /**
     * 👇 Create a target group for listener
     */
    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${projectName}-target-group`, {
      vpc: vpc,
      port: 3000,
      targetType: elbv2.TargetType.IP,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetGroupName: `${projectName}-target-group`,
      healthCheck: {
        path: "/",
        healthyHttpCodes: "200",
      },
    });

    /**
     * 👇 Add target group to listener
     */
    listenerHTTP.addTargetGroups(`${projectName}-default-https-response`, {
      targetGroups: [targetGroup],
    });

    /**
     * 👇 Create ECS Cluster
     */
    const cluster = new ecs.Cluster(this, `${projectName}-cluster`, {
      vpc,
      clusterName: `${projectName}-cluster`,
    });

    /**
     * 👇 Create Fargate task definition
     */
    const fargateTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      `${projectName}-task-def`,
      {
        memoryLimitMiB: 1024,
        cpu: 512,
      }
    );

    /**
     * 👇 Create Fargate container
     */
    const container = fargateTaskDefinition.addContainer(`${projectName}-container`, {
      containerName: `${projectName}-container`,
      image: ecs.ContainerImage.fromAsset("../backend-api"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "nest-app",
        logRetention: log.RetentionDays.ONE_MONTH,
      }),
    });

    /**
     * 👇 Open container port
     */
    container.addPortMappings({
      containerPort: 3000,
      hostPort: 3000,
    });

    /**
     * 👇 Create Fargate service
     */
    const service = new ecs.FargateService(this, `${projectName}-service`, {
      cluster,
      serviceName: `${projectName}-service`,
      taskDefinition: fargateTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [securityGroupApp],
    });

    /**
     * 👇 Attach this service to an Application Load Balancer
     */
    service.attachToApplicationTargetGroup(targetGroup);

    /**
     * 👇 Create a record set
     */
    new route53.ARecord(this, `${projectName}-alias-record`, {
      zone: hostedZone,
      recordName: `backend.${domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(alb)
      ),
    });
  }
}
