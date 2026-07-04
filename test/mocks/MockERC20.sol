// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Token gia lap dung de test, mo phong USDC/EURC (6 decimals) tren local
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Ham mint tu do, CHI DUNG CHO TEST, khong duoc dua vao production
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}