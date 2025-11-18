import { ethers } from "hardhat";

async function main() {
  const Token = await ethers.getContractFactory("MyToken");
  const name = "MyToken";
  const symbol = "MTK";
  const initialSupply = ethers.parseUnits("1000000", 18);
  const token = await Token.deploy(name, symbol, initialSupply);
  await token.waitForDeployment();
  console.log(`MyToken deployed to ${token.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});