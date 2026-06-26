terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # Opcional: descomente e ajuste para guardar o state remoto (recomendado).
  # backend "s3" {
  #   bucket = "araujo-prev-tfstate"
  #   key    = "export-worker/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}
