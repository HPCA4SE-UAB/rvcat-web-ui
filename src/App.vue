<template>
    <RouterView />
</template>

<style>
  body {
    width:      100vf;
    height:     100vh;
    max-width:  100vf;
    max-height: 100vh;
    font-family: 'Trebuchet MS', sans-serif;
    font-size:  2.5vh;
    height:     100%;
    margin:     0;
    padding:    0;
    overflow:   hidden;
    background: #e3e3e3;
  }
  ::-webkit-scrollbar {
    width: 0.75vh;
    height:0.75vh;
  }
  ::-webkit-scrollbar-track {
    width:10px;
    background:none;
  }
  ::-webkit-scrollbar-thumb {
    background:rgb(167, 167, 167);
    border-radius:10px;
    height:0.75vh;
  }

  /* Handle on hover */
  ::-webkit-scrollbar-thumb:hover {
    background: #8b8b8b;
  }

  .main {
    height:   100%;
    width:    100%;
    overflow: auto;
    padding:  2px 2px;
    z-index:  10;       
    position: relative;
    background:    white;
    border-radius: 5px;
    box-shadow:    0 1px 0 rgba(0,0,0,0.08);
  }
  
  .header {
    display:     flex;
    align-items: center;
    padding:     8px 8px;
    font-size:   14px;
    justify-content: space-between;
  }

  .section-title-and-info {
    display:     flex;
    align-items: center;
    gap:         6px; 
    flex-wrap:   wrap;
  }
 
  .header-title {
    font-size:    18px;
    font-weight:  600
  }

  .dropdown-wrapper {
    display:       flex;
    align-items:   center;
    flex-wrap:     nowrap;
    gap:           0.4rem;
    margin-top:    5px;
    margin-bottom: 5px;
  }
  .dropdown-header {
    all:         unset;  /* button reset */
    width:       auto;
    cursor:      pointer;
    background:  #f3f3f3;
    padding:     6px 10px;
    display:     inline-flex;
    align-items: center;
    gap:         0.4rem;
    font-size:   1.1rem;
  }
  .dropdown-header:hover {
    background: #eaeaea;
  }
  .dropdown-title {
    flex:      1;
    font-size: 1.0rem;
    overflow:  hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  #num-iters {
    width:     6ch;
    font-size: 14px;
  }

  #run-button{
    display: block;
    cursor:  pointer;
    left:    3px;
  }

  .arrow {
    opacity:   0.8;
    font-size: 0.85em;
  }

  .iters-group {
    display:     inline-flex;
    align-items: center;
    gap:         6px;
  }
  .iters-group input[type="number"] {
    width:      8ch;
    text-align: center;
  }
  .iters-label {
    font-size:   15px;
    font-weight: 500;
    text-align: center;
    justify-content: center;
  }
 
  .blue-button {
    background: #e6f0ff;
    color:      #1a4fb3;
    border:     1px solid #7aa2e3;
    padding:    6px 14px;
    font-size:  14px;
    line-height:   1.2;
    border-radius: 6px;
    cursor:        pointer;
    font-weight:   600;
    white-space:   nowrap;
    flex-shrink:   1;

    transition: 
      background 0.15s ease, 
      color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.05s ease;  
  } 
  .blue-button.active {
    background:   #1a4fb3;
    border-color: #1a4fb3;
    color:        white;
    box-shadow:  inset 0 0 0 1px rgba(255,255,255,0.4);
  }
  .blue-button:active {
    transform: translateY(1px);
  }
  .blue-button:hover {
    background: #006fb9;
    color:      white;
  }
  .blue-button[disabled] {
    opacity: 0.5;
    cursor:default;
  }

  input {
    font-size: 2.5vh;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal         {
    background: white;
    padding: 20px;
    border-radius: 8px;
    width: 30%;
    position: relative;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    background: rgba(255,255,255);
    z-index: 1000;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
  .error {
    color: red;
    margin: 6px 0;
  }

  /* Folding animation */
  .fold-enter-active, .fold-leave-active {
    transition: max-height 0.25s ease, opacity 0.2s ease;
    overflow: hidden;
  }
  .fold-enter-from, .fold-leave-to {
    max-height: 0;
    opacity: 0;
  }
  .fold-enter-to, .fold-leave-from {
    max-height: 500px;
    opacity: 1;
  }

  .info-icon {
    display:      inline-flex;
    align-items:  center;
    margin-right: 9px;
    margin-leftt: 9px;
    cursor:       pointer;
  }
  .info-img {
    height: 16px;
    width:  16px;
  }

</style>
