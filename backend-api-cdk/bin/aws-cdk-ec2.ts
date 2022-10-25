#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AwsCdkEc2Stack } from '../lib/aws-cdk-ec2-stack';

const app = new cdk.App();
new AwsCdkEc2Stack(app, 'AwsCdkEc2Stack');
