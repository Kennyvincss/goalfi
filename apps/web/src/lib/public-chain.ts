import { PM_AMM_DEPLOYMENTS, type ClusterName } from "@goalfi/chain/browser";

export const PUBLIC_CLUSTER = (process.env.NEXT_PUBLIC_GOALFI_CLUSTER ?? "devnet") as ClusterName;
export const PUBLIC_DEPLOYMENT = PM_AMM_DEPLOYMENTS[PUBLIC_CLUSTER];
