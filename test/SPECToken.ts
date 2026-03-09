import { expect } from "chai";
import { ethers } from "hardhat";

describe("SPECToken", function () {
  it("mints initial supply to deployer", async function () {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SPECToken");
    const token = await Token.deploy();
    await token.waitForDeployment();
    const expectedSupply = ethers.parseUnits("1000000000", 18);
    const balance = await token.balanceOf(deployer.address);
    expect(balance).to.equal(expectedSupply);
    const total = await token.totalSupply();
    expect(total).to.equal(expectedSupply);
  });
});
