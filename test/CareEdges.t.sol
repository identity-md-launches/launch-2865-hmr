// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { GameTest, HamsterHarness } from "./helpers/GameTest.sol";
import { HamsterRunNFT } from "../src/HamsterRunNFT.sol";
import { MatchQueue } from "../src/MatchQueue.sol";
import { Activity, GameMath, WeightClass } from "../src/GameMath.sol";
import { IERC721Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @notice Boundaries and failure paths of feeding, training and body weight. Expected values are the
///         literals that DESIGN.md's formulas give by hand, not values recomputed through GameMath.
contract CareEdgesTest is GameTest {
    function _harness() private returns (HamsterHarness harness) {
        harness = new HamsterHarness(owner);
        nft = harness;
        queue = new MatchQueue(address(nft));
        vm.startPrank(owner);
        nft.setMintOpen(true);
        nft.setMatchQueue(address(queue));
        vm.stopPrank();
    }

    function _body(uint256 id) private view returns (uint256) {
        return nft.hamster(id).bodyScore;
    }

    // ---------------------------------------------------------------- hunger and neglect schedule

    function test_newbornNeglectFollowsThePinnedSchedule() public {
        uint256 id = _mint(alice);
        uint256 born = block.timestamp;
        assertEq(_body(id), 50);
        vm.warp(born + 1);
        assertEq(_body(id), 45, "first begun hungry day");
        vm.warp(born + 1 days - 1);
        assertEq(_body(id), 45, "still the first hungry day and no complete idle day");
        vm.warp(born + 1 days);
        assertEq(_body(id), 40, "first complete idle day");
        vm.warp(born + 1 days + 1);
        assertEq(_body(id), 35, "second begun hungry day");
        vm.warp(born + 2 days);
        assertEq(_body(id), 30, "second complete idle day");
        assertEq(uint256(nft.hamster(id).weight), uint256(WeightClass.Obese));
    }

    function test_feedingStopsHungerDamageButNeverRefundsIdleDamage() public {
        uint256 id = _mintFed(alice, 1); // 56
        uint256 start = block.timestamp;
        uint256 fedAt = start + 5 days + 1;
        vm.warp(fedAt);
        // idle: 5 complete days. hunger: 2 days + 1 second past expiry is the third begun day.
        assertEq(_body(id), 56 - 25 - 15);
        _feed(alice, id, 1);
        assertEq(_body(id), 22, "16 + 6 food, already applied neglect is not charged twice");
        assertEq(nft.hamster(id).fedUntil, fedAt + 72 hours);
        vm.warp(fedAt + 1 days);
        assertEq(_body(id), 17, "one more idle day and no hunger while fed");
        vm.warp(fedAt + 3 days);
        assertEq(_body(id), 7, "exact expiry is still not hungry");
        vm.warp(fedAt + 3 days + 1);
        assertEq(_body(id), 2, "hunger restarts counting from the new expiry");
    }

    function test_longNeglectSaturatesAtZeroAndFoodRecoversFromThere() public {
        uint256 id = _mintFed(alice, 2);
        vm.warp(block.timestamp + 3650 days);
        assertEq(_body(id), 0);
        _feed(alice, id, 0);
        assertEq(_body(id), 0, "low food cannot go below zero");
        _feed(alice, id, 2);
        assertEq(_body(id), 12);
        assertEq(uint256(nft.hamster(id).weight), uint256(WeightClass.Obese));
    }

    function test_repeatedFoodSaturatesBothEndsOfTheBodyRange() public {
        uint256 up = _mint(alice);
        for (uint256 i; i < 5; ++i) {
            _feed(alice, up, 2);
        }
        assertEq(_body(up), 100, "50 + 5 * 12 clamps");
        _feed(alice, up, 2);
        assertEq(_body(up), 100, "feeding at the ceiling keeps it");

        uint256 down = _mint(bob);
        for (uint256 i; i < 13; ++i) {
            _feed(bob, down, 0);
        }
        assertEq(_body(down), 0, "50 - 13 * 4 clamps");
    }

    function testFuzz_neglectIsPathIndependentAndIdempotent(uint8 tierSeed, uint32 first, uint32 second)
        public
    {
        uint256 d1 = bound(first, 0, 40 days);
        uint256 d2 = bound(second, 0, 40 days);
        uint256 id = _mintFed(alice, uint8(bound(tierSeed, 0, 2)));
        uint256 start = vm.getBlockTimestamp();
        uint256 clean = vm.snapshotState();

        // Touch part way, then touch again at the end.
        vm.warp(start + d1);
        vm.prank(alice);
        nft.transferFrom(alice, alice, id);
        vm.warp(start + d1 + d2);
        uint256 touched = _body(id);
        vm.prank(alice);
        nft.transferFrom(alice, alice, id);
        assertEq(_body(id), touched, "a state touch only stores what the view already reported");

        // No touches at all gives the same score at the same instant.
        assertTrue(vm.revertToState(clean));
        vm.warp(start + d1 + d2);
        assertEq(_body(id), touched, "touching can neither dodge nor double-charge neglect");
    }

    function testFuzz_scoreNeverRisesFromTimeAlone(uint8 tierSeed, uint32 first, uint32 second) public {
        uint256 id = _mintFed(alice, uint8(bound(tierSeed, 0, 2)));
        uint256 t1 = vm.getBlockTimestamp() + bound(first, 0, 30 days);
        vm.warp(t1);
        uint256 earlier = _body(id);
        vm.warp(t1 + bound(second, 0, 30 days));
        assertLe(_body(id), earlier);
    }

    // ---------------------------------------------------------------- weight classes

    function test_weightClassBoundariesArePinned() public pure {
        assertEq(uint256(GameMath.weightClass(0)), uint256(WeightClass.Obese));
        assertEq(uint256(GameMath.weightClass(34)), uint256(WeightClass.Obese));
        assertEq(uint256(GameMath.weightClass(35)), uint256(WeightClass.Normal));
        assertEq(uint256(GameMath.weightClass(69)), uint256(WeightClass.Normal));
        assertEq(uint256(GameMath.weightClass(70)), uint256(WeightClass.Fit));
        assertEq(uint256(GameMath.weightClass(100)), uint256(WeightClass.Fit));
    }

    function testFuzz_betterScoreNeverGivesAWorseClass(uint8 seed) public pure {
        uint256 score = bound(seed, 0, 99);
        // The enum runs Fit=0, Normal=1, Obese=2: a healthier class has the lower value.
        assertLe(uint256(GameMath.weightClass(score + 1)), uint256(GameMath.weightClass(score)));
    }

    /// @dev Reaches each boundary through the real feed path, then reads the class the race would use. The
    ///      stored enum is what a round snapshots, and hamster() recomputes it, so only a lock shows it.
    function test_storedEnumFollowsTheScoreAcrossBoundariesInBothDirections() public {
        HamsterHarness harness = _harness();
        uint8[4] memory targets = [34, 35, 69, 70];
        WeightClass[4] memory expected =
            [WeightClass.Obese, WeightClass.Normal, WeightClass.Normal, WeightClass.Fit];
        for (uint256 viaLowFood; viaLowFood < 2; ++viaLowFood) {
            for (uint256 i; i < 4; ++i) {
                address player = makeAddr(string.concat("boundary", vm.toString(viaLowFood * 4 + i)));
                vm.deal(player, 1 ether);
                uint256 id = _mintFed(player, 0);
                if (viaLowFood == 1) {
                    harness.setBodyForTest(id, uint256(targets[i]) + 4);
                    _feed(player, id, 0); // -4
                } else {
                    harness.setBodyForTest(id, uint256(targets[i]) - 6);
                    _feed(player, id, 1); // +6
                }
                assertEq(_body(id), targets[i]);
                _enqueue(player, id);
            }
        }
        uint256 round = queue.requestRound(0);
        MatchQueue.Snapshot[] memory racers = queue.roundRacers(round);
        assertEq(racers.length, 8);
        for (uint256 i; i < 8; ++i) {
            assertEq(uint256(racers[i].weight), uint256(expected[i % 4]), "stored enum matches its score");
        }
    }

    function test_withoutTrainingEveryFoodRegimeDriftsDownInTierOrder() public {
        uint256 low = _mintFed(alice, 0);
        uint256 mid = _mintFed(bob, 1);
        uint256 high = _mintFed(carol, 2);
        for (uint256 cycle; cycle < 5; ++cycle) {
            vm.warp(nft.hamster(low).fedUntil);
            _feed(alice, low, 0);
            _feed(bob, mid, 1);
            _feed(carol, high, 2);
        }
        assertEq(_body(low), 0, "46 - 5 * 19 clamps");
        assertEq(_body(mid), 11, "56 - 5 * 9");
        assertEq(_body(high), 47, "62 - 5 * 3");
        assertEq(uint256(nft.hamster(low).weight), uint256(WeightClass.Obese));
        assertEq(uint256(nft.hamster(mid).weight), uint256(WeightClass.Obese));
        assertEq(uint256(nft.hamster(high).weight), uint256(WeightClass.Normal));
    }

    function test_trainedPetsRankByFoodTierAndBeatUntrainedOnes() public {
        uint256 low = _mintFed(alice, 0);
        uint256 high = _mintFed(bob, 2);
        uint256 untrained = _mintFed(carol, 2);
        vm.prank(alice);
        nft.startTraining(low);
        vm.prank(bob);
        nft.startTraining(high);
        vm.warp(block.timestamp + nft.TRAIN_SECONDS());
        nft.settleTraining(low);
        nft.settleTraining(high);
        // Low: 46 + 2 + 0 + min(10,10). High: 62 + 2 + 4 + min(20,10). Carol's only food: 62.
        assertEq(_body(low), 58);
        assertEq(_body(high), 78);
        assertEq(_body(untrained), 62);
        assertEq(uint256(nft.hamster(high).weight), uint256(WeightClass.Fit));
        assertEq(uint256(nft.hamster(untrained).weight), uint256(WeightClass.Normal));
    }

    function test_largerGainEarnsMoreBodyCreditOnlyUpToTheDocumentedCap() public {
        HamsterHarness harness = _harness();
        // Same food and score, different stamina: 10 gains 10; 900 gains 2; 910 gains 1.
        uint256[3] memory staminas = [uint256(10), 900, 910];
        uint256[3] memory expectedBody = [uint256(46 + 2 + 10), 46 + 2 + 2, 46 + 2 + 1];
        for (uint256 i; i < 3; ++i) {
            address player = makeAddr(string.concat("gain credit", vm.toString(i)));
            vm.deal(player, 1 ether);
            uint256 id = _mintFed(player, 0);
            harness.setStaminaForTest(id, staminas[i]);
            vm.prank(player);
            nft.startTraining(id);
            vm.warp(vm.getBlockTimestamp() + nft.TRAIN_SECONDS());
            nft.settleTraining(id);
            assertEq(_body(id), expectedBody[i]);
            vm.warp(vm.getBlockTimestamp() - nft.TRAIN_SECONDS());
        }
    }

    // ---------------------------------------------------------------- feeding

    function testFuzz_feedAlwaysSetsDeadlineFromNowAndNeverShortensIt(
        uint8 firstTier,
        uint8 secondTier,
        uint32 gapSeed
    ) public {
        uint8 tier2 = uint8(bound(secondTier, 0, 2));
        uint256 id = _mintFed(alice, uint8(bound(firstTier, 0, 2)));
        uint256 previous = nft.hamster(id).fedUntil;
        uint256 at = vm.getBlockTimestamp() + bound(gapSeed, 0, 200 days);
        vm.warp(at);
        _feed(alice, id, tier2);
        HamsterRunNFT.Hamster memory ham = nft.hamster(id);
        assertEq(ham.fedUntil, at + 72 hours);
        assertGe(ham.fedUntil, previous);
        assertEq(ham.foodTier, tier2);
        assertEq(ham.trainBps, nft.foodTrainBps(tier2));
        assertFalse(nft.isHungry(id));
    }

    function testFuzz_hungryExactlyAfterTheDeadline(uint32 elapsedSeed) public {
        uint256 id = _mintFed(alice, 0);
        uint256 elapsed = bound(elapsedSeed, 0, 10 days);
        vm.warp(vm.getBlockTimestamp() + elapsed);
        assertEq(nft.isHungry(id), elapsed > 72 hours);
    }

    function test_cheaperRefeedDowngradesTheNextTrainingBonus() public {
        uint256 id = _mintFed(alice, 2);
        assertEq(nft.previewTrainingGain(id), 20);
        _feed(alice, id, 0);
        assertEq(nft.previewTrainingGain(id), 10, "the last feed decides, not the best recent one");
        assertEq(nft.hamster(id).trainBps, 10_000);
        vm.prank(alice);
        nft.startTraining(id);
        (,, uint8 tier) = nft.training(id);
        assertEq(tier, 0);
    }

    function test_paymentRaisedOrLoweredInTheSameBlockNeverOverOrUndercharges() public {
        uint256 id = _mint(alice);
        vm.prank(owner);
        nft.setFoodConfig([uint256(1 ether), 2 ether, 3 ether], [uint256(10_000), 15_000, 20_000]);
        vm.startPrank(alice);
        vm.expectRevert(HamsterRunNFT.IncorrectPayment.selector);
        nft.feed{ value: 0.0001 ether }(id, 0); // a stale, cheaper quote
        vm.stopPrank();
        vm.prank(owner);
        nft.setFoodConfig([uint256(1), 2, 3], [uint256(10_000), 15_000, 20_000]);
        vm.startPrank(alice);
        vm.expectRevert(HamsterRunNFT.IncorrectPayment.selector);
        nft.feed{ value: 1 ether }(id, 0); // a stale, dearer quote is refused, not kept
        vm.stopPrank();
        assertEq(address(nft).balance, 0);
        assertEq(alice.balance, 100 ether);
        assertTrue(nft.isHungry(id));
    }

    function test_rejectedFeedLeavesEveryFieldUntouched() public {
        uint256 id = _mintFed(alice, 1);
        HamsterRunNFT.Hamster memory before = nft.hamster(id);
        uint256 balanceBefore = address(nft).balance;
        vm.startPrank(alice);
        vm.expectRevert(HamsterRunNFT.IncorrectPayment.selector);
        nft.feed{ value: 0.0003 ether - 1 }(id, 2);
        vm.expectRevert(HamsterRunNFT.IncorrectPayment.selector);
        nft.feed{ value: 0.0003 ether + 1 }(id, 2);
        vm.expectRevert(HamsterRunNFT.IncorrectPayment.selector);
        nft.feed(id, 2);
        vm.expectRevert(HamsterRunNFT.InvalidTier.selector);
        nft.feed{ value: 0.0003 ether }(id, 3);
        vm.expectRevert(HamsterRunNFT.InvalidTier.selector);
        nft.feed{ value: 0.0003 ether }(id, type(uint8).max);
        vm.stopPrank();
        assertEq(keccak256(abi.encode(nft.hamster(id))), keccak256(abi.encode(before)));
        assertEq(address(nft).balance, balanceBefore);
    }

    function test_operatorsMayMoveAPetButNeverPlayIt() public {
        uint256 id = _mintFed(alice, 0);
        vm.prank(alice);
        nft.setApprovalForAll(bob, true);
        vm.startPrank(bob);
        vm.expectRevert(HamsterRunNFT.NotTokenOwner.selector);
        nft.feed{ value: 0.0001 ether }(id, 0);
        vm.expectRevert(HamsterRunNFT.NotTokenOwner.selector);
        nft.startTraining(id);
        vm.expectRevert(MatchQueue.NotTokenOwner.selector);
        queue.enqueue(id);
        vm.stopPrank();
        vm.prank(alice);
        nft.startTraining(id);
        vm.prank(bob);
        vm.expectRevert(HamsterRunNFT.NotTokenOwner.selector);
        nft.cancelTraining(id);
    }

    // ---------------------------------------------------------------- training

    function test_trainingGainTableFromTheDesignFormula() public pure {
        assertEq(GameMath.trainingGain(0, 10_000), 11, "denominator 10");
        assertEq(GameMath.trainingGain(9, 10_000), 11, "S/10 still 0");
        assertEq(GameMath.trainingGain(10, 10_000), 10);
        assertEq(GameMath.trainingGain(10, 15_000), 15);
        assertEq(GameMath.trainingGain(10, 20_000), 20);
        assertEq(GameMath.trainingGain(20, 15_000), 13, "9 * 1.5 rounds down");
        assertEq(GameMath.trainingGain(100, 20_000), 12);
        assertEq(GameMath.trainingGain(909, 10_000), 2, "last stamina with a nonzero fraction");
        assertEq(GameMath.trainingGain(910, 10_000), 1, "floor of the diminishing term");
        assertEq(GameMath.trainingGain(type(uint256).max, 10_000), 1);
        assertEq(GameMath.trainingGain(type(uint256).max, 20_000), 2);
        assertEq(GameMath.trainingGain(type(uint256).max, 50_000), 5, "largest configurable multiplier");
    }

    /// @dev Bounded at 909: from 910 up the mid tier rounds down to the low tier's gain. That is reported in
    ///      .imd-findings.json rather than asserted here as correct.
    function testFuzz_foodTiersStrictlyOrderTheGainBelowTheFloor(uint256 staminaSeed) public view {
        uint256 stamina = bound(staminaSeed, 0, 909);
        uint256 low = GameMath.trainingGain(stamina, nft.foodTrainBps(0));
        uint256 mid = GameMath.trainingGain(stamina, nft.foodTrainBps(1));
        uint256 high = GameMath.trainingGain(stamina, nft.foodTrainBps(2));
        assertLt(low, mid);
        assertLt(mid, high);
    }

    function testFuzz_foodNeverLowersTheGainAtAnyStamina(uint256 stamina) public view {
        uint256 low = GameMath.trainingGain(stamina, nft.foodTrainBps(0));
        uint256 mid = GameMath.trainingGain(stamina, nft.foodTrainBps(1));
        uint256 high = GameMath.trainingGain(stamina, nft.foodTrainBps(2));
        assertLe(low, mid);
        assertLe(mid, high);
        assertLt(low, high, "the top tier always beats the bottom one");
    }

    function test_realPathStaminaPassesTheDiminishingFloorWithoutACap() public {
        uint256 id = _mintFed(alice, 2);
        uint256 previousGain = type(uint256).max;
        uint256 stamina = nft.hamster(id).stamina;
        while (stamina <= 1000) {
            if (nft.hamster(id).fedUntil < vm.getBlockTimestamp() + nft.TRAIN_SECONDS()) {
                _feed(alice, id, 2);
            }
            uint256 gain = nft.previewTrainingGain(id);
            assertGe(gain, 2, "top food keeps growing a pet at every stamina reached");
            assertLe(gain, previousGain, "gain diminishes with stamina");
            previousGain = gain;
            _train(alice, id);
            assertEq(nft.hamster(id).stamina, stamina + gain, "the stored gain is credited exactly");
            stamina += gain;
        }
        assertEq(previousGain, 2);
    }

    function test_trainingAtFullStaminaWidthKeepsGrowingUntilArithmeticStops() public {
        HamsterHarness harness = _harness();
        uint256 id = _mintFed(alice, 2);
        harness.setStaminaForTest(id, type(uint256).max - 2);
        _train(alice, id); // gain 2 lands exactly on the maximum
        assertEq(nft.hamster(id).stamina, type(uint256).max);
        vm.prank(alice);
        nft.startTraining(id);
        vm.warp(vm.getBlockTimestamp() + nft.TRAIN_SECONDS());
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        nft.settleTraining(id);
        assertEq(
            uint256(nft.hamster(id).activity), uint256(Activity.Training), "the failed settle rolled back"
        );
    }

    function test_startingOnTheLastPossibleSecondIsAllowedAndSettlesAfterExpiry() public {
        uint256 id = _mintFed(alice, 0);
        uint256 deadline = nft.hamster(id).fedUntil;
        vm.warp(deadline - nft.TRAIN_SECONDS());
        vm.prank(alice);
        nft.startTraining(id);
        (uint256 readyAt,,) = nft.training(id);
        assertEq(readyAt, deadline, "work finishes exactly at the fed deadline");
        vm.warp(deadline + 1);
        assertTrue(nft.isHungry(id));
        nft.settleTraining(id);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.Hungry.selector);
        nft.startTraining(id);
    }

    function test_settleAndCancelRejectEveryNonTrainingActivity() public {
        uint256 a = _mintFed(alice, 0);
        uint256 b = _mintFed(bob, 0);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.settleTraining(a);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.cancelTraining(a);

        _enqueue(alice, a);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.settleTraining(a);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.cancelTraining(a);

        _enqueue(bob, b);
        queue.requestRound(0);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.settleTraining(a);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.cancelTraining(a);
    }

    function test_cancelledTrainingCreditsNothingAndCannotBeReplayed() public {
        uint256 id = _mintFed(alice, 2);
        uint256 body = _body(id);
        vm.prank(alice);
        nft.startTraining(id);
        vm.warp(block.timestamp + nft.TRAIN_SECONDS());
        vm.prank(alice);
        nft.cancelTraining(id); // cancelling completed work still forfeits it
        (uint256 readyAt, uint256 gain, uint8 tier) = nft.training(id);
        assertEq(readyAt, 0);
        assertEq(gain, 0);
        assertEq(tier, 0);
        assertEq(nft.hamster(id).stamina, 10);
        assertEq(_body(id), body);
        vm.expectRevert(HamsterRunNFT.NoTraining.selector);
        nft.settleTraining(id);
    }

    function test_cancelDoesNotResetTheIdleClockButSettlingDoes() public {
        uint256 cancelled = _mintFed(alice, 2);
        uint256 settled = _mintFed(bob, 2);
        uint256 start = block.timestamp;
        vm.prank(alice);
        nft.startTraining(cancelled);
        vm.prank(bob);
        nft.startTraining(settled);
        vm.warp(start + nft.TRAIN_SECONDS());
        vm.prank(alice);
        nft.cancelTraining(cancelled);
        nft.settleTraining(settled);
        uint256 cancelledBody = _body(cancelled);
        uint256 settledBody = _body(settled);
        assertEq(cancelledBody, 62);
        assertEq(settledBody, 78);
        vm.warp(start + 1 days);
        assertEq(_body(cancelled), cancelledBody - 5, "one full day since birth with no settled training");
        assertEq(_body(settled), settledBody, "only 18 hours since the settlement");
    }

    function test_transferKeepsAllCareStateAndGivesNoReset() public {
        uint256 id = _mintFed(alice, 2);
        _train(alice, id);
        vm.warp(block.timestamp + 1 days);
        HamsterRunNFT.Hamster memory before = nft.hamster(id);
        (uint256 week, uint256 used) = nft.matchQuota(id);
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        assertEq(keccak256(abi.encode(nft.hamster(id))), keccak256(abi.encode(before)));
        (uint256 weekAfter, uint256 usedAfter) = nft.matchQuota(id);
        assertEq(weekAfter, week);
        assertEq(usedAfter, used);
        vm.prank(alice);
        vm.expectRevert(HamsterRunNFT.NotTokenOwner.selector);
        nft.startTraining(id);
        vm.prank(bob);
        nft.startTraining(id);
    }

    // ---------------------------------------------------------------- nonexistent pets

    function testFuzz_nonexistentPetsRevertEverywhere(uint256 idSeed) public {
        uint256 id = idSeed % 2 == 0 ? 0 : bound(idSeed, 1, type(uint256).max);
        if (id != 0 && id <= nft.totalSupply()) id = 0;
        bytes memory missing = abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id);
        vm.startPrank(alice);
        vm.expectRevert(missing);
        nft.feed{ value: 0.0001 ether }(id, 0);
        vm.expectRevert(missing);
        nft.startTraining(id);
        vm.expectRevert(missing);
        nft.cancelTraining(id);
        vm.expectRevert(missing);
        nft.settleTraining(id);
        vm.expectRevert(missing);
        nft.hamster(id);
        vm.expectRevert(missing);
        nft.isHungry(id);
        vm.expectRevert(missing);
        nft.matchesThisWeek(id);
        vm.expectRevert(missing);
        nft.previewTrainingGain(id);
        vm.expectRevert(missing);
        queue.enqueue(id);
        vm.expectRevert(missing);
        queue.leaveQueue(id);
        vm.expectRevert(missing);
        queue.bandOf(id);
        vm.expectRevert(MatchQueue.NotQueued.selector);
        queue.evictExpired(id);
        vm.stopPrank();
    }
}
