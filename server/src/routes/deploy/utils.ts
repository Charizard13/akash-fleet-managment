import { exec } from "child_process";
import { promisify } from "util";

import { Bid, SuccessfulLease } from "../../type";
import { saveBidsToDB } from "../../utils/db";
import { generateYamlWithWebs } from "./yaml";
const execAsync = promisify(exec);

const WAIT_TIME = 30000;

export const handleSdlFlow = async () => {
  const respondersLength = await deployGenericSDL();
  const { bids, owner } = await deployAllBiddersSDL(respondersLength);

  await saveBidsToDB(bids);

  let leasesFulfilled: SuccessfulLease[] = [];
  let leasedRejected: SuccessfulLease[] = [];

  let filteredBids: Bid[] = [];
  const providers = [...new Set(bids.map((bid) => bid.bid.bid_id.provider))];

  providers.forEach((provider) => {
    const providerBids = bids.filter(
      (bid) => bid.bid.bid_id.provider === provider
    );
    const sortedBids = providerBids.sort(
      (a, b) => Number(a.bid.price.amount) - Number(b.bid.price.amount)
    );
    filteredBids.push(sortedBids[0]);
  });

  for (const bid of filteredBids) {
    const leaseResponse = await lease(bid);
    if (!leaseResponse.isSuccess) {
      leasesFulfilled.push(leaseResponse);
    } else {
      leasedRejected.push(leaseResponse);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // TODO: add rejected leases to a blacklist of providers
  const leasedAccepted = leasesFulfilled.filter((lease) => lease.isSuccess);

  return { leasedAccepted, owner };
};

export const deployGenericSDL = async (
  AKASH_KEY_NAME = "myWallet-akt"
): Promise<number> => {
  const { stdout } = await execAsync(
    `provider-services tx deployment create ./src/routes/deploy/Mor-S-SDL-T1.yml -y --from ${AKASH_KEY_NAME} ${getDynamicVariables(
      {
        AKASH_GAS: true,
        AKASH_GAS_PRICES: true,
        AKASH_GAS_ADJUSTMENT: true,
        KEY_RING: true,
        AKASH_CHAIN_ID: true,
      }
    )}`
  );
  const data = JSON.parse(stdout) as {
    logs: { events: { attributes: { key: string; value: string }[] }[] }[];
  };

  const AKASH_DSEQ = Number(
    data.logs[0].events[0].attributes.find((attr) => attr.key === "dseq")?.value
  );
  const AKASH_ACCOUNT_ADDRESS =
    data.logs[0].events[0].attributes.find((attr) => attr.key === "owner")
      ?.value ?? "";

  await new Promise((resolve) => setTimeout(resolve, WAIT_TIME));

  const { stdout: envVars } = await execAsync("env");

  console.log({ envVars });

  console.log({ AKASH_ACCOUNT_ADDRESS, AKASH_DSEQ });

  const { stdout: bidStdout } = await execAsync(
    `provider-services query market bid list --owner=${AKASH_ACCOUNT_ADDRESS} --dseq=${AKASH_DSEQ} --gseq=0 --oseq=0 ${getDynamicVariables(
      { AKASH_CHAIN_ID: true }
    )} --state=open -o json`
  );
  const bids = JSON.parse(bidStdout).bids;
  console.log({ bids, length: bids.length });

  return bids.length;
};

export const deployAllBiddersSDL = async (respondersLength: number) => {
  generateYamlWithWebs(respondersLength);

  const AKASH_KEY_NAME = process.env.AKASH_KEY_NAME;

  await new Promise((resolve) => setTimeout(resolve, WAIT_TIME));

  console.log(
    `provider-services tx deployment create ./src/routes/deploy/Mor-S-SDL-T2.yml -y --from ${AKASH_KEY_NAME} ${getDynamicVariables(
      {
        AKASH_GAS: true,
        AKASH_GAS_PRICES: true,
        AKASH_GAS_ADJUSTMENT: true,
        KEY_RING: true,
        AKASH_CHAIN_ID: true,
      }
    )}`
  );

  const { stdout } = await execAsync(
    `provider-services tx deployment create ./src/routes/deploy/Mor-S-SDL-T2.yml -y --from ${AKASH_KEY_NAME} ${getDynamicVariables(
      {
        AKASH_GAS: true,
        AKASH_GAS_PRICES: true,
        AKASH_GAS_ADJUSTMENT: true,
        KEY_RING: true,
        AKASH_CHAIN_ID: true,
      }
    )}`
  );
  const data = JSON.parse(stdout) as {
    logs: { events: { attributes: { key: string; value: string }[] }[] }[];
  };

  console.log({ name: "deployAllBiddersSDL-1", data });

  const AKASH_DSEQ = Number(
    data.logs[0].events[0].attributes.find((attr) => attr.key === "dseq")?.value
  );
  const AKASH_ACCOUNT_ADDRESS =
    data.logs[0].events[0].attributes.find((attr) => attr.key === "owner")
      ?.value ?? "";

  console.log({ AKASH_ACCOUNT_ADDRESS, AKASH_DSEQ });

  await new Promise((resolve) => setTimeout(resolve, WAIT_TIME));

  const { stdout: bidStdout } = await execAsync(
    `provider-services query market bid list --owner=${AKASH_ACCOUNT_ADDRESS} --dseq=${AKASH_DSEQ} ${getDynamicVariables(
      { AKASH_CHAIN_ID: true }
    )} --state=open -o json`
  );

  console.log({ name: "deployAllBiddersSDL-2", data: bidStdout });

  const bids = JSON.parse(bidStdout).bids as Bid[];

  if (bids.length === 0) {
    throw new Error("No bids found in T-2");
  }

  return { bids, owner: AKASH_ACCOUNT_ADDRESS };
};

export const lease = async (bid: Bid): Promise<SuccessfulLease> => {
  const AKASH_KEY_NAME = process.env.AKASH_KEY_NAME;
  const command =
    "provider-services tx market lease create -y --dseq=" +
    bid.bid.bid_id.dseq +
    " --gseq=" +
    bid.bid.bid_id.gseq +
    " --oseq=1 --provider=" +
    bid.bid.bid_id.provider +
    " --from " +
    AKASH_KEY_NAME +
    " " +
    getDynamicVariables({
      AKASH_GAS: true,
      AKASH_GAS_PRICES: true,
      AKASH_GAS_ADJUSTMENT: true,
      KEY_RING: true,
      AKASH_CHAIN_ID: true,
    });
  const { stdout } = await execAsync(command);

  console.log({ name: "lease", data: stdout });

  const isSuccess = await sendManifest(
    bid.bid.bid_id.dseq,
    bid.bid.bid_id.provider,
    bid.bid.bid_id.gseq
  );

  return {
    dseq: bid.bid.bid_id.dseq,
    provider: bid.bid.bid_id.provider,
    isSuccess,
    price: Number(bid.bid.price.amount),
  };
};

export const sendManifest = async (
  dseq: string,
  provider: string,
  gseq: number
): Promise<boolean> => {
  const AKASH_KEY_NAME = process.env.AKASH_KEY_NAME;
  const command =
    "provider-services send-manifest Mor-S-SDL-T2.yml --dseq " +
    dseq +
    " --provider=" +
    provider +
    " --from=" +
    AKASH_KEY_NAME +
    " --gseq=" +
    gseq +
    " --oseq=1 " +
    getDynamicVariables({
      KEY_RING: true,
    }) +
    " -o json";

  const { stdout } = await execAsync(command);
  console.log({ name: "sendManifest", data: stdout });

  const res = JSON.parse(stdout) as { status: "FAIL" | "PASS" }[];
  return res[0].status === "PASS";
};

// export const getManifestStatus = async (
//   dseq: string,
//   provider: string
// ): Promise<void> => {
//   const AKASH_KEY_NAME = process.env.AKASH_KEY_NAME;
//   await execAsync(
//     `provider-services query deployment get --dseq ${dseq} --provider ${provider} -o json`
//   );
// };

export const closeDeployment = async (
  id: string,
  owner: string
): Promise<void> => {
  const AKASH_KEY_NAME = process.env.AKASH_KEY_NAME;
  const { stdout } = await execAsync(
    `provider-services tx deployment close --dseq ${id} --from ${AKASH_KEY_NAME} --owner=${owner} ${getDynamicVariables(
      {
        AKASH_GAS: true,
        AKASH_GAS_PRICES: true,
        AKASH_GAS_ADJUSTMENT: true,
        KEY_RING: true,
        AKASH_CHAIN_ID: true,
      }
    )}`
  );
  console.log({ name: "closeDeployment", data: stdout });
};

export const getDynamicVariables = ({
  AKASH_GAS,
  AKASH_GAS_PRICES,
  AKASH_GAS_ADJUSTMENT,
  KEY_RING,
  NODE = "https://rpc.akashnet.net:443",
  AKASH_CHAIN_ID,
}: {
  NODE?: string;
  AKASH_CHAIN_ID?: boolean;
  AKASH_GAS?: boolean;
  AKASH_GAS_PRICES?: boolean;
  AKASH_GAS_ADJUSTMENT?: boolean;
  AKASH_OWNER?: boolean;
  KEY_RING?: boolean;
}) => {
  let output = `--node ${NODE} `;

  if (AKASH_CHAIN_ID) {
    output += `--chain-id=akashnet-2 `;
  }

  if (AKASH_GAS) {
    output += ` --gas=auto `;
  }

  if (AKASH_GAS_PRICES) {
    output += `--gas-prices=0.025uakt `;
  }

  if (AKASH_GAS_ADJUSTMENT) {
    output += `--gas-adjustment=1.25 `;
  }

  if (KEY_RING) {
    output += `--keyring-backend test `;
  }

  return output;
};
