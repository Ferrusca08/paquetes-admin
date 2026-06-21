# PackTrack 📦

**App de gestión de paquetes para edificios residenciales.**

Centraliza el flujo completo: **recepción → notificación inmediata → retiro verificado**.

## Stack

| Capa | Tecnología |
|------|-----------|
| Mobile | React Native + Expo SDK 56 (TypeScript), Expo Router |
| API | AWS AppSync (GraphQL) |
| Auth | Amazon Cognito User Pools (guardias, residentes, admins) |
| Data | Amazon DynamoDB (single-table design) |
| OCR | Amazon Textract |
| Storage | Amazon S3 (URLs prefirmadas) |
| Push | Amazon SNS + WhatsApp (Meta Cloud API) |
| Events | Amazon EventBridge |
| IaC | Terraform (módulos separados) |
| Client SDK | AWS Amplify (Auth + API) |

## Estructura

```
packtrack/
├── infra/          # Terraform — infraestructura como código
├── functions/      # Lambdas (TypeScript)
├── mobile/         # Expo App (TypeScript)
└── schema/         # GraphQL schema (fuente de verdad)
```

## Fases de desarrollo

- **Fase 1** ✅ Infra base: Cognito, DynamoDB, S3, AppSync skeleton
- **Fase 2** ✅ Schema GraphQL + resolvers Lambda + registerPackage + confirmPickup
- **Fase 3** ✅ Textract OCR + S3 presigned URLs + CI/CD GitHub Actions (OIDC)
- **Fase 4** ✅ App Expo: login, flujo guardia (listar/registrar/retirar), flujo residente (mis paquetes + código)
- **Fase 5** ✅ Notificaciones: SNS push + WhatsApp (DEMO_MODE)

## Setup

```bash
# Terraform
cd infra
cp terraform.tfvars.example terraform.tfvars  # Edita con tus valores
terraform init
terraform plan -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
```

## Licencia

Privado — Todos los derechos reservados.
