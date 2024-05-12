import { DEPLOYMENT_RESOURCES } from "../../utils/akash/consts";
import { Router } from "express";

import { BidID, Lease } from "@akashnetwork/akash-api/akash/market/v1beta4";

import { handleSdlFlow } from "./utils";
import { ProviderSupply } from "../../type";
import { closeDeployment } from "../../utils/akash/closeDeployment";

const router = Router();
const MAX_LEASES = 10;

router.post("/create", async (req, res) => {
  try {
    // const deployment = req.body?.deployment as DeploymentResources;

    // if (!deployment) {
    //   return res.status(400).send("deployment is required");
    // }

    const resourceUsed = DEPLOYMENT_RESOURCES["MORPHEUS"];

    // TODO: save prices of each provider
    const providerSupplies: ProviderSupply[] = [];

    let isBidsEmpty = false;
    let leasesResponses: { bidId: BidID }[] = [];
    let successfulLeaseCount = 0;
    while (!isBidsEmpty) {
      const { leasesFulfilled } = await handleSdlFlow();
      console.log(`Leases fulfilled: ${leasesFulfilled.length}`);
      if (leasesFulfilled.length === 0) {
        isBidsEmpty = true;
        return;
      }

      for (const lease of leasesFulfilled) {
        if (successfulLeaseCount >= MAX_LEASES) {
          isBidsEmpty = true;
          return;
        }

        const providerIndex = providerSupplies.findIndex(
          (provider) => provider.name === lease.bidId?.provider,
        );

        if (providerIndex === -1) {
          providerSupplies.push({
            ...resourceUsed,
            name: lease?.bidId?.provider ?? "",
          });
        } else {
          providerSupplies[providerIndex].cpu += resourceUsed.cpu;
          providerSupplies[providerIndex].gpu += resourceUsed.gpu;
          providerSupplies[providerIndex].memory += resourceUsed.memory;
          providerSupplies[providerIndex].storage += resourceUsed.storage;
        }

        successfulLeaseCount++;
        leasesResponses.push(lease as { bidId: BidID });
      }
    }

    for (const lease of leasesResponses) {
      const message = await closeDeployment(lease.bidId?.dseq.toString() ?? "");
      console.log(message);

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    res.status(201).json(providerSupplies);
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal server error");
  }
});

export default router;
