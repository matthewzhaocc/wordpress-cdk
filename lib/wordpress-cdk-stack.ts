import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecsPatterns from '@aws-cdk/aws-ecs-patterns';
import * as efs from '@aws-cdk/aws-efs';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';
export class WordpressCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'wp-vpc');
    const credSecret = new secretsManager.Secret(this, 'db-secret', {
      secretName: '/hasura',
      generateSecretString: {
        passwordLength: 20,
        excludePunctuation: true
      }
    })
    const db = new rds.DatabaseCluster(this, 'wp-db', {
      engine: rds.DatabaseClusterEngine.auroraMysql({version: rds.AuroraMysqlEngineVersion.VER_5_7_12}),
      instanceProps: {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.R5, ec2.InstanceSize.LARGE),
          vpc,
          vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE
          },
      },
      credentials: rds.Credentials.fromPassword('matthew', credSecret.secretValue),
      defaultDatabaseName: 'wordpress'
    })
    const fs = new efs.FileSystem(this, 'fs', {
      fileSystemName: 'wordpress',
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE
      }
    })

    const wp = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'wpsvc', {
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry('library/wordpress:latest'),
        environment: {
          WORDPRESS_DB_NAME: 'wordpress',
          WORDPRESS_DB_USER: 'matthew',
          WORDPRESS_DB_PASSWORD: credSecret.secretValue.toString(),
          WORDPRESS_DB_HOST: db.clusterEndpoint.hostname,
          WORDPRESS_TABLE_PREFIX: 'wp_'
        }
      },
      cpu: 256,
      memoryLimitMiB: 1024,
      vpc,
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE
      },
    })

    db.connections.allowDefaultPortFrom(wp.service.connections)
    fs.connections.allowDefaultPortFrom(wp.service.connections)
    wp.taskDefinition.addVolume({
      efsVolumeConfiguration: {
        fileSystemId: fs.fileSystemId
      },
      name: 'wp-vol',
    })
    wp.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/var/www/html',
      readOnly: false,
      sourceVolume: 'wp-vol'
    })
    wp.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: "200-399"
    })
  }
}
