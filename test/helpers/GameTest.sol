// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { HamsterRunNFT } from "../../src/HamsterRunNFT.sol";
import { MatchQueue } from "../../src/MatchQueue.sol";
import { Activity, GameMath, WeightClass } from "../../src/GameMath.sol";

abstract contract GameTest is Test {
    HamsterRunNFT internal nft;
    MatchQueue internal queue;
    address internal owner;
    address internal alice;
    address internal bob;
    address internal carol;
    address internal keeper;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        keeper = makeAddr("permissionless keeper");
        nft = new HamsterRunNFT(owner);
        queue = new MatchQueue(address(nft));
        vm.startPrank(owner);
        nft.setMatchQueue(address(queue));
        nft.setMintOpen(true);
        vm.stopPrank();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _mint(address player) internal returns (uint256 id) {
        vm.prank(player);
        id = nft.mint();
    }

    function _feed(address player, uint256 id, uint8 tier) internal {
        uint256 price = nft.foodPrices(tier);
        vm.prank(player);
        nft.feed{ value: price }(id, tier);
    }

    function _mintFed(address player, uint8 tier) internal returns (uint256 id) {
        id = _mint(player);
        _feed(player, id, tier);
    }

    function _enqueue(address player, uint256 id) internal {
        vm.prank(player);
        queue.enqueue(id);
    }

    function _train(address player, uint256 id) internal {
        vm.prank(player);
        nft.startTraining(id);
        (uint256 readyAt,,) = nft.training(id);
        vm.warp(readyAt);
        vm.prank(keeper);
        nft.settleTraining(id);
    }

    function _readyRound(uint256 roundId, bytes32 hash) internal {
        (, uint256 target,,,,) = queue.roundInfo(roundId);
        vm.roll(target + 1);
        vm.setBlockhash(target, hash);
    }

    function _fulfill(uint256 roundId, bytes32 hash) internal returns (uint256[] memory) {
        _readyRound(roundId, hash);
        vm.prank(keeper);
        queue.fulfillRound(roundId);
        return queue.roundMatchIds(roundId);
    }

    /// @dev Advance past the anti-steering wait window so every waiting pet becomes lockable.
    function _waitQueueWindow() internal {
        vm.roll(vm.getBlockNumber() + queue.QUEUE_WAIT_BLOCKS());
    }

    function _pair(address playerA, uint256 idA, address playerB, uint256 idB)
        internal
        returns (uint256 roundId)
    {
        _enqueue(playerA, idA);
        _enqueue(playerB, idB);
        _waitQueueWindow();
        roundId = queue.requestRound(queue.bandOf(idA));
    }
}

/// @dev Test-only reachability of uint256 arithmetic extremes; never included in the launch.
contract HamsterHarness is HamsterRunNFT {
    constructor(address initialOwner) HamsterRunNFT(initialOwner) { }

    function setStaminaForTest(uint256 id, uint256 value) external {
        _hamsters[id].stamina = value;
    }

    function setBodyForTest(uint256 id, uint256 value) external {
        require(value <= 100);
        _hamsters[id].bodyScore = value;
        _hamsters[id].weight = GameMath.weightClass(value);
    }
}
