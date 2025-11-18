import { expect } from "chai";
import { ethers } from "hardhat";

describe("MyToken", function () {
  it("mints initial supply to deployer", async function () {
    const [deployer] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MyToken");
    const token = await Token.deploy("MyToken", "MTK", ethers.parseUnits("1000", 18));
    await token.waitForDeployment();
    const balance = await token.balanceOf(deployer.address);
    expect(balance).to.equal(ethers.parseUnits("1000", 18));
    const total = await token.totalSupply();
    expect(total).to.equal(ethers.parseUnits("1000", 18));
  });
});