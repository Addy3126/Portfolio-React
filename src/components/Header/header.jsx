import React from 'react'
import './header.css'

const Header = () => {
  return (
    <div className="header">
        <div className="headerItem itemNAme">
            <ul>
                <li>Local Time</li>
                <li className="header_LocalTime">12:00 AM</li>
            </ul>
        </div>
        <div className="headerItem itemPlace">
            <ul>
                <li>Based in</li>
                <li>Delhi, India</li>
            </ul>
        </div>
        <div className="headerItem itemAval">
            <ul>
                <li>Status</li>
                <li>Available</li>
            </ul>
        </div>
    </div>
  )
}

export default Header